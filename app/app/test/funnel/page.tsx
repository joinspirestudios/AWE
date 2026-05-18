'use client'

/**
 * /test/funnel
 *
 * Unified validation surface for the AI pipeline.
 *
 * Single-column input flow: paste a script, fetch one or more reference
 * carousels, hit Analyze. Both inputs are visible at once so the mental
 * model is "this is my carousel brief," not two separate workflows.
 *
 * The target slide count is derived from the fetched references
 * (median of their slide counts), with a manual override.
 *
 * When Gemini's analyzeReference ships, it slots into the references
 * section — same data, new analysis pass alongside the script result.
 */

import { useMemo, useState } from 'react'

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

interface Reference {
  id: string
  sourceUrl: string
  sourcePlatform: string
  images: Array<{ src: string; order: number }>
  uploadedAt: string
  ownerUsername?: string
  caption?: string
}

interface SlideOutput {
  purpose: string
  headline: string
  body?: string
  emphasis: string[]
}

interface AnalysisOutput {
  niche: string
  subNiche?: string
  tone: string
  audience: string
  recommendedSlideCount: number
  slides: SlideOutput[]
}

interface UsageOutput {
  provider: string
  model: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  estimatedCostUsd?: number
}

interface AnalysisResponse {
  analysis: AnalysisOutput
  usage: UsageOutput
}

// ────────────────────────────────────────────────────────────────────────
// Seed examples
// ────────────────────────────────────────────────────────────────────────

const EXAMPLES: { label: string; description: string; script: string }[] = [
  {
    label: 'Polished',
    description: 'Finished copy with deliberate wording',
    script: `Most freelancers underprice by 40%.

Here's why.

You see what your competitor charges. You charge less to win the work. You forget your competitor is profitable at their rate. You aren't.

Three rules:
1. Price for your costs, not theirs.
2. Add 30% for tax and overhead.
3. Raise rates twice a year. Not once. Twice.

Stop racing to the bottom.`,
  },
  {
    label: 'Loose draft',
    description: 'Informal, ideas in rough order',
    script: `ok so the idea is - why your skincare isn't working
basically people use too many products
the order matters - thin to thick
but also like, ph levels?? acids first, hydration last
plus you have to give a product 6 weeks to work
ppl give up at 2 weeks
end with the routine i use myself

oh and add stat about how 70% of skincare users use wrong order (saw on reddit lol verify)`,
  },
  {
    label: 'Bullets',
    description: 'Numbered or dashed list of points',
    script: `5 things I learned about saving for a house

- start a separate account
- automate transfers (mine is every Friday)
- track every expense for 1 month, you'll find about $200 to cut
- a 20% down payment is a myth, conventional loans accept 5-10%
- look at houses 20% under your max budget, you'll need it for repairs`,
  },
]

const PURPOSE_COLORS: Record<string, string> = {
  hook: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  point: 'bg-neutral-500/15 text-neutral-300 border-neutral-500/30',
  data: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  quote: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  comparison: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  step: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  cta: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
}

function purposeStyle(purpose: string): string {
  return (
    PURPOSE_COLORS[purpose] ??
    'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30'
  )
}

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export default function TestFunnelPage() {
  // Script state
  const [script, setScript] = useState('')

  // References state
  const [references, setReferences] = useState<Reference[]>([])
  const [referenceUrl, setReferenceUrl] = useState('')
  const [fetchingRef, setFetchingRef] = useState(false)
  const [refError, setRefError] = useState<string | null>(null)

  // Slide count override (manual)
  const [manualSlideCount, setManualSlideCount] = useState('')

  // Analysis state
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(
    null,
  )
  const [showRaw, setShowRaw] = useState(false)

  // ────────────────────────────────────────────────────────────────────────
  // Derived: auto slide count from references (median for robustness)
  // ────────────────────────────────────────────────────────────────────────

  const autoSlideCount = useMemo(() => {
    if (references.length === 0) return null
    const counts = references.map((r) => r.images.length).filter((n) => n > 0)
    if (counts.length === 0) return null
    const sorted = [...counts].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 0) {
      const a = sorted[mid - 1] ?? 0
      const b = sorted[mid] ?? 0
      return Math.round((a + b) / 2)
    }
    return sorted[mid] ?? null
  }, [references])

  const effectiveSlideCount = useMemo(() => {
    if (manualSlideCount.trim()) {
      const n = Number.parseInt(manualSlideCount, 10)
      if (Number.isFinite(n) && n >= 1 && n <= 20) return n
    }
    return autoSlideCount
  }, [manualSlideCount, autoSlideCount])

  // ────────────────────────────────────────────────────────────────────────
  // Actions
  // ────────────────────────────────────────────────────────────────────────

  async function fetchReference() {
    if (!referenceUrl.trim()) return
    setFetchingRef(true)
    setRefError(null)
    try {
      const res = await fetch('/api/fetch-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: referenceUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(
          data?.message ?? data?.error ?? `Request failed (${res.status})`,
        )
      }
      const ref: Reference = {
        ...data.reference,
        ownerUsername: data.meta?.ownerUsername,
        caption: data.meta?.caption,
      }
      setReferences((prev) => [...prev, ref])
      setReferenceUrl('')
    } catch (err) {
      setRefError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setFetchingRef(false)
    }
  }

  function removeReference(id: string) {
    setReferences((prev) => prev.filter((r) => r.id !== id))
  }

  async function analyze() {
    if (!script.trim()) {
      setAnalysisError('Script is required.')
      return
    }
    setAnalyzing(true)
    setAnalysisError(null)
    setAnalysisResult(null)
    try {
      const body: Record<string, unknown> = { script }
      if (effectiveSlideCount) {
        body.referenceSlideCount = effectiveSlideCount
      }
      const res = await fetch('/api/analyze-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(
          data?.message ?? data?.error ?? `Request failed (${res.status})`,
        )
      }
      setAnalysisResult(data as AnalysisResponse)
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setAnalyzing(false)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Test: funnel
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Paste a script and fetch reference carousels. Analyzing uses the
            references to set the target slide count automatically.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          {/* ───────────────── INPUT COLUMN ───────────────── */}
          <section className="space-y-6">
            {/* ─── Script section ─── */}
            <div className="space-y-3">
              <SectionHeader
                label="Script"
                badge={
                  script.length > 0
                    ? `${script.length.toLocaleString()} chars`
                    : null
                }
              />

              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    type="button"
                    key={ex.label}
                    onClick={() => setScript(ex.script)}
                    className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-800"
                  >
                    {ex.label}
                    <span className="ml-2 text-neutral-500">
                      {ex.description}
                    </span>
                  </button>
                ))}
              </div>

              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste your script here..."
                className="h-64 w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900 p-4 font-mono text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
              />
            </div>

            {/* ─── References section ─── */}
            <div className="space-y-3">
              <SectionHeader
                label="References"
                badge={references.length > 0 ? `${references.length}` : null}
              />

              <div className="flex gap-2">
                <input
                  type="url"
                  value={referenceUrl}
                  onChange={(e) => setReferenceUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !fetchingRef &&
                      referenceUrl.trim()
                    ) {
                      fetchReference()
                    }
                  }}
                  placeholder="https://www.instagram.com/p/..."
                  className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={fetchReference}
                  disabled={fetchingRef || !referenceUrl.trim()}
                  className="rounded-md border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm text-neutral-100 transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {fetchingRef ? 'Fetching…' : 'Add'}
                </button>
              </div>

              {refError && (
                <div className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">
                  {refError}
                </div>
              )}

              {references.length === 0 && !fetchingRef && (
                <div className="rounded-lg border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
                  No references yet. Paste an Instagram post URL to add one.
                </div>
              )}

              {references.length > 0 && (
                <div className="space-y-2">
                  {references.map((ref) => (
                    <ReferenceCard
                      key={ref.id}
                      reference={ref}
                      onRemove={removeReference}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ─── Slide count control ─── */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <div className="text-neutral-400">Target slide count</div>
                  <div className="mt-0.5 text-lg font-medium text-neutral-100">
                    {effectiveSlideCount ?? 'auto'}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-2 text-neutral-400">
                    Override
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={manualSlideCount}
                      onChange={(e) => setManualSlideCount(e.target.value)}
                      placeholder="auto"
                      className="w-16 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
                    />
                  </label>
                </div>
              </div>
              {autoSlideCount !== null && !manualSlideCount.trim() && (
                <p className="mt-2 text-xs text-neutral-500">
                  Median of {references.length} reference
                  {references.length === 1 ? '' : 's'} (
                  {references.map((r) => r.images.length).join(', ')} slides).
                </p>
              )}
              {autoSlideCount === null && !manualSlideCount.trim() && (
                <p className="mt-2 text-xs text-neutral-500">
                  No references yet. The model will infer slide count from
                  script density.
                </p>
              )}
              {manualSlideCount.trim() && (
                <p className="mt-2 text-xs text-neutral-500">
                  Manual override active.
                </p>
              )}
            </div>

            {/* ─── Analyze button ─── */}
            <button
              type="button"
              onClick={analyze}
              disabled={analyzing || !script.trim()}
              className="w-full rounded-md bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
            >
              {analyzing ? 'Analyzing…' : 'Analyze'}
            </button>
          </section>

          {/* ───────────────── RESULTS COLUMN ───────────────── */}
          <section className="min-h-[24rem] space-y-4">
            <ResultsPanel
              loading={analyzing}
              error={analysisError}
              result={analysisResult}
              showRaw={showRaw}
              setShowRaw={setShowRaw}
            />
          </section>
        </div>
      </div>
    </main>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────────

function SectionHeader({
  label,
  badge,
}: {
  label: string
  badge: string | null
}) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </h2>
      {badge && (
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
          {badge}
        </span>
      )}
    </div>
  )
}

function ReferenceCard({
  reference,
  onRemove,
}: {
  reference: Reference
  onRemove: (id: string) => void
}) {
  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-neutral-200">
            {reference.ownerUsername
              ? `@${reference.ownerUsername}`
              : reference.sourcePlatform}
          </div>
          <div className="text-xs text-neutral-500">
            {reference.images.length} slide
            {reference.images.length === 1 ? '' : 's'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRemove(reference.id)}
          aria-label="Remove reference"
          className="rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-red-400"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {reference.images.slice(0, 4).map((img) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={img.order}
            src={img.src}
            alt=""
            className="aspect-square w-full rounded object-cover"
            loading="lazy"
          />
        ))}
      </div>
      {reference.images.length > 4 && (
        <div className="mt-1 text-center text-xs text-neutral-500">
          +{reference.images.length - 4} more
        </div>
      )}
    </article>
  )
}

function ResultsPanel({
  loading,
  error,
  result,
  showRaw,
  setShowRaw,
}: {
  loading: boolean
  error: string | null
  result: AnalysisResponse | null
  showRaw: boolean
  setShowRaw: (v: boolean | ((p: boolean) => boolean)) => void
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
        <strong>Error:</strong> {error}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-400">
        Calling Claude…
      </div>
    )
  }

  if (!result) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
        Results will appear here.
      </div>
    )
  }

  return (
    <>
      {/* Carousel-level */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Field label="Niche" value={result.analysis.niche} />
          <Field label="Sub-niche" value={result.analysis.subNiche ?? '—'} />
          <Field label="Tone" value={result.analysis.tone} />
          <Field label="Audience" value={result.analysis.audience} />
        </div>
        <div className="mt-3 border-t border-neutral-800 pt-3 text-sm text-neutral-400">
          Recommended slides:{' '}
          <span className="text-neutral-100">
            {result.analysis.recommendedSlideCount}
          </span>
        </div>
      </div>

      {/* Slide cards */}
      <div className="space-y-3">
        {result.analysis.slides.map((slide, i) => (
          <article
            key={i}
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
          >
            <div className="mb-2 flex items-center gap-3">
              <span className="text-xs text-neutral-500">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 text-xs font-medium ${purposeStyle(slide.purpose)}`}
              >
                {slide.purpose}
              </span>
            </div>
            <h3 className="text-lg font-medium leading-snug">
              <HighlightedHeadline
                text={slide.headline}
                emphasis={slide.emphasis}
              />
            </h3>
            {slide.body && (
              <p className="mt-2 text-sm text-neutral-400">{slide.body}</p>
            )}
            {slide.emphasis.length > 0 && (
              <div className="mt-2 text-xs text-neutral-500">
                Emphasis: {slide.emphasis.join(' · ')}
              </div>
            )}
          </article>
        ))}
      </div>

      {/* Usage */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Model" value={result.usage.model} />
          <Stat label="Latency" value={`${result.usage.durationMs} ms`} />
          <Stat
            label="Input tokens"
            value={result.usage.inputTokens?.toLocaleString() ?? '—'}
          />
          <Stat
            label="Cached"
            value={
              result.usage.cachedInputTokens
                ? result.usage.cachedInputTokens.toLocaleString()
                : '—'
            }
          />
          <Stat
            label="Est. cost"
            value={`$${result.usage.estimatedCostUsd?.toFixed(5) ?? '0'}`}
          />
        </div>
      </div>

      {/* Raw JSON */}
      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="text-xs text-neutral-500 underline hover:text-neutral-300"
      >
        {showRaw ? 'Hide' : 'Show'} raw JSON
      </button>
      {showRaw && (
        <pre className="overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs text-neutral-300">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </>
  )
}

function HighlightedHeadline({
  text,
  emphasis,
}: {
  text: string
  emphasis: string[]
}) {
  if (!emphasis.length) return <>{text}</>
  const escaped = emphasis
    .filter(Boolean)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!escaped.length) return <>{text}</>
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        emphasis.includes(part) ? (
          <mark
            key={i}
            className="rounded bg-amber-400/30 px-1 text-amber-200"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-neutral-100">{value}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="text-neutral-100">{value}</div>
    </div>
  )
}
