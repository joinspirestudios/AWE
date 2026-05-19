'use client'

/**
 * /test/funnel
 *
 * Unified validation surface for the AI pipeline.
 *
 * Inputs (stacked):
 *   - Script — paste your copy
 *   - References — fetch one or more reference carousels by URL
 *
 * Hitting Analyze runs both analyzeScript (Claude) and, when references
 * are present, analyzeReference (Gemini) in parallel. Results appear in
 * the right column:
 *   - StyleSpec card (read-only) — from Gemini
 *   - Carousel-level fields (editable) — from Claude
 *   - Slide cards (editable, deletable) — from Claude
 *
 * Edit semantics: every text field on slides and carousel-level fields
 * is an inline-editable input. Changes update local state immediately.
 * Re-running Analyze overwrites edits with a fresh response.
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

interface FontGuess {
  family: string
  weight: number
  style: 'normal' | 'italic'
  confidence: number
}

interface StyleSpec {
  colors: { primary: string[]; accents: string[] }
  typography: {
    headlineStyle: 'serif' | 'sans' | 'display' | 'monospace'
    headlineWeight: 'light' | 'regular' | 'medium' | 'bold' | 'black'
    bodyStyle: 'serif' | 'sans'
    hierarchy: 'high-contrast' | 'subtle'
    headlineFontGuesses: FontGuess[]
    bodyFontGuesses: FontGuess[]
  }
  layout: {
    alignment: 'left' | 'center' | 'right' | 'mixed'
    grid: 'tight' | 'loose' | 'asymmetric'
    fullBleed: boolean
  }
  background: {
    type: 'solid' | 'gradient' | 'photo' | 'photo-overlay' | 'texture'
    mood: 'dark' | 'light' | 'high-contrast'
  }
  motifs: string[]
  slidePattern: 'consistent' | 'varied' | 'progressive'
}

interface StyleResponse {
  styleSpec: StyleSpec
  usage: UsageOutput
}

// LayoutSpec — per-slide composition templates plus recurring patterns
interface LayoutElement {
  type:
    | 'headline'
    | 'body'
    | 'image'
    | 'callout'
    | 'number'
    | 'decoration'
    | 'logo'
    | 'badge'
    | 'quote'
  region:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'middle-left'
    | 'middle-center'
    | 'middle-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
    | 'full-bleed'
    | 'overlay'
  size: 'small' | 'medium' | 'large' | 'full'
  role: string
  notes?: string
}

interface SlideLayout {
  slideIndex: number
  postId?: string
  composition: string
  elements: LayoutElement[]
  notes?: string
}

interface LayoutSpec {
  slides: SlideLayout[]
  consistency: 'high' | 'medium' | 'low'
  patterns: Array<{
    name: string
    description: string
    slideIndices: number[]
  }>
  notes?: string
}

interface LayoutResponse {
  layoutSpec: LayoutSpec
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

const CANONICAL_PURPOSES = [
  'hook',
  'point',
  'data',
  'quote',
  'comparison',
  'step',
  'cta',
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

// Shared input class for inline editing: minimal chrome, hover/focus reveal.
const INLINE_INPUT =
  '-mx-2 -my-1 rounded px-2 py-1 bg-transparent transition hover:bg-neutral-800/40 focus:bg-neutral-800/60 focus:outline-none border-0 w-full'

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

  // Analysis state (script)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(
    null,
  )

  // Analysis state (style / Gemini)
  const [analyzingStyle, setAnalyzingStyle] = useState(false)
  const [styleError, setStyleError] = useState<string | null>(null)
  const [styleResult, setStyleResult] = useState<StyleResponse | null>(null)

  // Analysis state (layouts / Gemini, runs in parallel with style)
  const [analyzingLayouts, setAnalyzingLayouts] = useState(false)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const [layoutResult, setLayoutResult] = useState<LayoutResponse | null>(null)

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
  // Actions: references
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

  // ────────────────────────────────────────────────────────────────────────
  // Actions: analyze (runs script + style in parallel)
  // ────────────────────────────────────────────────────────────────────────

  async function analyze() {
    if (!script.trim()) {
      setAnalysisError('Script is required.')
      return
    }

    // Clear previous results immediately so the UI doesn't show stale state.
    setAnalysisError(null)
    setStyleError(null)
    setLayoutError(null)
    setAnalysisResult(null)
    setStyleResult(null)
    setLayoutResult(null)
    setAnalyzing(true)
    if (references.length > 0) {
      setAnalyzingStyle(true)
      setAnalyzingLayouts(true)
    }

    // Build the inputs for all three passes
    const scriptBody: Record<string, unknown> = { script }
    if (effectiveSlideCount) scriptBody.referenceSlideCount = effectiveSlideCount

    const visionBody = {
      images: references.flatMap((r) =>
        r.images.map((img) => ({
          src: img.src,
          order: img.order,
          postId: r.id,
        })),
      ),
    }

    // Run all three in parallel. Each settles independently — a failed
    // vision pass doesn't take down the script analysis or the other
    // vision call.
    const [scriptResult, styleResult, layoutResult] = await Promise.allSettled([
      callJson<AnalysisResponse>('/api/analyze-script', scriptBody),
      references.length > 0
        ? callJson<StyleResponse>('/api/analyze-reference', visionBody)
        : Promise.resolve(null),
      references.length > 0
        ? callJson<LayoutResponse>('/api/analyze-layouts', visionBody)
        : Promise.resolve(null),
    ])

    if (scriptResult.status === 'fulfilled' && scriptResult.value) {
      setAnalysisResult(scriptResult.value)
    } else if (scriptResult.status === 'rejected') {
      setAnalysisError(
        scriptResult.reason instanceof Error
          ? scriptResult.reason.message
          : String(scriptResult.reason),
      )
    }

    if (styleResult.status === 'fulfilled' && styleResult.value) {
      setStyleResult(styleResult.value)
    } else if (styleResult.status === 'rejected') {
      setStyleError(
        styleResult.reason instanceof Error
          ? styleResult.reason.message
          : String(styleResult.reason),
      )
    }

    if (layoutResult.status === 'fulfilled' && layoutResult.value) {
      setLayoutResult(layoutResult.value)
    } else if (layoutResult.status === 'rejected') {
      setLayoutError(
        layoutResult.reason instanceof Error
          ? layoutResult.reason.message
          : String(layoutResult.reason),
      )
    }

    setAnalyzing(false)
    setAnalyzingStyle(false)
    setAnalyzingLayouts(false)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Actions: edit analysis result (slide + carousel-level)
  // ────────────────────────────────────────────────────────────────────────

  function updateCarouselMeta(updates: Partial<AnalysisOutput>) {
    setAnalysisResult((prev) =>
      prev ? { ...prev, analysis: { ...prev.analysis, ...updates } } : prev,
    )
  }

  function updateSlide(index: number, updates: Partial<SlideOutput>) {
    setAnalysisResult((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        analysis: {
          ...prev.analysis,
          slides: prev.analysis.slides.map((s, i) =>
            i === index ? { ...s, ...updates } : s,
          ),
        },
      }
    })
  }

  function deleteSlide(index: number) {
    setAnalysisResult((prev) => {
      if (!prev) return prev
      const newSlides = prev.analysis.slides.filter((_, i) => i !== index)
      return {
        ...prev,
        analysis: {
          ...prev.analysis,
          slides: newSlides,
          recommendedSlideCount: newSlides.length,
        },
      }
    })
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
            Paste a script and fetch reference carousels. Analyzing produces
            an editable slide breakdown and a style spec.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          {/* ───────────────── INPUT COLUMN ───────────────── */}
          <section className="space-y-6">
            {/* Script section */}
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

            {/* References section */}
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

            {/* Slide count control */}
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

            <button
              type="button"
              onClick={analyze}
              disabled={analyzing || analyzingStyle || analyzingLayouts || !script.trim()}
              className="w-full rounded-md bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
            >
              {analyzing || analyzingStyle || analyzingLayouts ? 'Analyzing…' : 'Analyze'}
            </button>
          </section>

          {/* ───────────────── RESULTS COLUMN ───────────────── */}
          <section className="min-h-[24rem] space-y-4">
            {/* Style spec result */}
            {analyzingStyle && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">
                Gemini analyzing references for style…
              </div>
            )}
            {styleError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
                <strong>Style analysis failed:</strong> {styleError}
              </div>
            )}
            {styleResult && <StyleSpecCard data={styleResult} />}

            {/* Layout spec result */}
            {analyzingLayouts && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">
                Gemini extracting layout templates…
              </div>
            )}
            {layoutError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
                <strong>Layout analysis failed:</strong> {layoutError}
              </div>
            )}
            {layoutResult && <LayoutSpecCard data={layoutResult} />}

            {/* Script analysis result */}
            <AnalysisPanel
              loading={analyzing}
              error={analysisError}
              result={analysisResult}
              onUpdateCarouselMeta={updateCarouselMeta}
              onUpdateSlide={updateSlide}
              onDeleteSlide={deleteSlide}
            />

            {/* Raw JSON toggle */}
            {(analysisResult || styleResult || layoutResult) && (
              <>
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  className="text-xs text-neutral-500 underline hover:text-neutral-300"
                >
                  {showRaw ? 'Hide' : 'Show'} raw JSON
                </button>
                {showRaw && (
                  <pre className="overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs text-neutral-300">
                    {JSON.stringify(
                      {
                        analysis: analysisResult,
                        style: styleResult,
                        layouts: layoutResult,
                      },
                      null,
                      2,
                    )}
                  </pre>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

async function callJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
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
  return data as T
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponents — sections & cards
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
          <CloseIcon />
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

// ────────────────────────────────────────────────────────────────────────
// Subcomponent — AnalysisPanel (editable carousel meta + slides)
// ────────────────────────────────────────────────────────────────────────

function AnalysisPanel({
  loading,
  error,
  result,
  onUpdateCarouselMeta,
  onUpdateSlide,
  onDeleteSlide,
}: {
  loading: boolean
  error: string | null
  result: AnalysisResponse | null
  onUpdateCarouselMeta: (updates: Partial<AnalysisOutput>) => void
  onUpdateSlide: (index: number, updates: Partial<SlideOutput>) => void
  onDeleteSlide: (index: number) => void
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
        <strong>Script analysis failed:</strong> {error}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-400">
        Claude analyzing script…
      </div>
    )
  }

  if (!result) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
        Script results will appear here.
      </div>
    )
  }

  return (
    <>
      {/* Carousel-level (editable) */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <EditableField
            label="Niche"
            value={result.analysis.niche}
            onChange={(v) => onUpdateCarouselMeta({ niche: v })}
          />
          <EditableField
            label="Sub-niche"
            value={result.analysis.subNiche ?? ''}
            placeholder="—"
            onChange={(v) =>
              onUpdateCarouselMeta({ subNiche: v.trim() ? v : undefined })
            }
          />
          <EditableField
            label="Tone"
            value={result.analysis.tone}
            onChange={(v) => onUpdateCarouselMeta({ tone: v })}
          />
          <EditableField
            label="Audience"
            value={result.analysis.audience}
            onChange={(v) => onUpdateCarouselMeta({ audience: v })}
          />
        </div>
        <div className="mt-3 border-t border-neutral-800 pt-3 text-sm text-neutral-400">
          {result.analysis.slides.length} slide
          {result.analysis.slides.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Slides (editable + deletable) */}
      <div className="space-y-3">
        {result.analysis.slides.map((slide, i) => (
          <EditableSlideCard
            key={i}
            index={i}
            slide={slide}
            onChange={(updates) => onUpdateSlide(i, updates)}
            onDelete={() => onDeleteSlide(i)}
          />
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
    </>
  )
}

function EditableSlideCard({
  index,
  slide,
  onChange,
  onDelete,
}: {
  index: number
  slide: SlideOutput
  onChange: (updates: Partial<SlideOutput>) => void
  onDelete: () => void
}) {
  const [emphasisInput, setEmphasisInput] = useState('')

  function addEmphasis() {
    const v = emphasisInput.trim()
    if (!v) return
    if (slide.emphasis.includes(v)) {
      setEmphasisInput('')
      return
    }
    onChange({ emphasis: [...slide.emphasis, v] })
    setEmphasisInput('')
  }

  function removeEmphasis(value: string) {
    onChange({ emphasis: slide.emphasis.filter((e) => e !== value) })
  }

  return (
    <article className="group rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      {/* Header: index, purpose, delete */}
      <div className="mb-3 flex items-center gap-3">
        <span className="text-xs text-neutral-500">
          {String(index + 1).padStart(2, '0')}
        </span>
        <PurposeInput
          value={slide.purpose}
          onChange={(v) => onChange({ purpose: v })}
        />
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete slide"
          className="ml-auto rounded p-1 text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:bg-neutral-800 hover:text-red-400 focus:opacity-100"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Headline */}
      <input
        type="text"
        value={slide.headline}
        onChange={(e) => onChange({ headline: e.target.value })}
        placeholder="Headline"
        className={`${INLINE_INPUT} text-lg font-medium leading-snug`}
      />

      {/* Body */}
      <textarea
        value={slide.body ?? ''}
        onChange={(e) =>
          onChange({ body: e.target.value || undefined })
        }
        placeholder="Add body text…"
        rows={2}
        className={`${INLINE_INPUT} mt-2 resize-y text-sm text-neutral-400`}
      />

      {/* Emphasis */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-neutral-500">Emphasis:</span>
        {slide.emphasis.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200"
          >
            {value}
            <button
              type="button"
              onClick={() => removeEmphasis(value)}
              aria-label={`Remove emphasis ${value}`}
              className="text-amber-200/60 hover:text-amber-100"
            >
              <CloseIcon size={10} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={emphasisInput}
          onChange={(e) => setEmphasisInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addEmphasis()
            }
          }}
          onBlur={addEmphasis}
          placeholder="+ add"
          className="min-w-[80px] flex-1 rounded bg-transparent px-1 py-0.5 text-xs text-neutral-300 placeholder:text-neutral-600 focus:bg-neutral-800/60 focus:outline-none"
        />
      </div>
    </article>
  )
}

function PurposeInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <>
      <input
        type="text"
        list="purpose-options"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-auto rounded-md border px-2 py-0.5 text-xs font-medium focus:outline-none ${purposeStyle(value)}`}
        style={{ minWidth: `${Math.max(60, value.length * 8 + 24)}px` }}
      />
      <datalist id="purpose-options">
        {CANONICAL_PURPOSES.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </>
  )
}

function EditableField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${INLINE_INPUT} mt-0.5 text-neutral-100 placeholder:text-neutral-600`}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponent — StyleSpecCard (read-only display from Gemini)
// ────────────────────────────────────────────────────────────────────────

function StyleSpecCard({ data }: { data: StyleResponse }) {
  const { styleSpec, usage } = data

  return (
    <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
          Style spec
        </h3>
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
          Gemini
        </span>
        <span className="ml-auto text-[10px] text-neutral-500">
          {usage.durationMs} ms · ${usage.estimatedCostUsd?.toFixed(5) ?? '0'}
        </span>
      </div>

      {/* Colors */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500">
          Colors
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {styleSpec.colors.primary.map((hex, i) => (
            <ColorSwatch key={`p-${i}`} hex={hex} kind="primary" />
          ))}
          {styleSpec.colors.accents.map((hex, i) => (
            <ColorSwatch key={`a-${i}`} hex={hex} kind="accent" />
          ))}
        </div>
      </div>

      {/* Typography */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
            Headline · {styleSpec.typography.headlineStyle} ·{' '}
            {styleSpec.typography.headlineWeight}
          </div>
          <FontGuessList guesses={styleSpec.typography.headlineFontGuesses} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
            Body · {styleSpec.typography.bodyStyle}
          </div>
          <FontGuessList guesses={styleSpec.typography.bodyFontGuesses} />
        </div>
      </div>

      {/* Layout & background */}
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Stat label="Alignment" value={styleSpec.layout.alignment} />
        <Stat label="Grid" value={styleSpec.layout.grid} />
        <Stat
          label="Background"
          value={`${styleSpec.background.type} · ${styleSpec.background.mood}`}
        />
        <Stat label="Hierarchy" value={styleSpec.typography.hierarchy} />
      </div>

      {/* Motifs */}
      {styleSpec.motifs.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
            Motifs
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {styleSpec.motifs.map((m, i) => (
              <span
                key={i}
                className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-neutral-800 pt-2 text-xs text-neutral-500">
        Slide pattern:{' '}
        <span className="text-neutral-300">{styleSpec.slidePattern}</span>
        {styleSpec.layout.fullBleed && (
          <span className="ml-3 text-neutral-300">full-bleed</span>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponent — LayoutSpecCard (read-only display from Gemini)
//
// Renders one mini "blueprint" per reference slide showing element
// placement on a 3×3 grid. Consistency rating + recurring patterns
// appear in the header / footer of the card.
// ────────────────────────────────────────────────────────────────────────

function LayoutSpecCard({ data }: { data: LayoutResponse }) {
  const { layoutSpec, usage } = data

  const consistencyColor: Record<typeof layoutSpec.consistency, string> = {
    high: 'text-emerald-300',
    medium: 'text-amber-300',
    low: 'text-rose-300',
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
          Layout spec
        </h3>
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
          Gemini
        </span>
        <span className="ml-auto flex items-center gap-3 text-[10px] text-neutral-500">
          <span>
            Consistency:{' '}
            <span className={consistencyColor[layoutSpec.consistency]}>
              {layoutSpec.consistency}
            </span>
          </span>
          <span>
            {usage.durationMs} ms · ${usage.estimatedCostUsd?.toFixed(5) ?? '0'}
          </span>
        </span>
      </div>

      {/* Per-slide blueprints */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {layoutSpec.slides.map((slide, i) => (
          <LayoutBlueprint key={i} slide={slide} />
        ))}
      </div>

      {/* Recurring patterns */}
      {layoutSpec.patterns.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
            Recurring patterns
          </div>
          <div className="mt-1 space-y-1.5">
            {layoutSpec.patterns.map((p, i) => (
              <div key={i} className="rounded-md bg-neutral-800/60 p-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-neutral-100">{p.name}</span>
                  <span className="text-neutral-500">
                    slides {p.slideIndices.map((idx) => idx + 1).join(', ')}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-neutral-400">
                  {p.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overall notes */}
      {layoutSpec.notes && (
        <div className="border-t border-neutral-800 pt-2 text-xs text-neutral-400">
          {layoutSpec.notes}
        </div>
      )}
    </div>
  )
}

function LayoutBlueprint({ slide }: { slide: SlideLayout }) {
  // When multiple elements share the same region (common with overlay or
  // middle-center), they would render at identical positions and the
  // later one would fully cover the earlier ones. Track each element's
  // index within its region peer group so we can offset stacked markers
  // and keep every element visible.
  const regionCounts = new Map<string, number>()
  const stackIndices = slide.elements.map((el) => {
    const current = regionCounts.get(el.region) ?? 0
    regionCounts.set(el.region, current + 1)
    return current
  })

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-1.5 text-[10px]">
        <span className="font-mono text-neutral-500">
          {String(slide.slideIndex + 1).padStart(2, '0')}
        </span>
        <span className="truncate text-neutral-300">{slide.composition}</span>
      </div>

      {/* 3×3 grid visualization of element placement */}
      <div className="relative aspect-square overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
        {/* Grid lines */}
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="border border-neutral-900/60"
              aria-hidden
            />
          ))}
        </div>

        {/* Elements positioned on the grid */}
        {slide.elements.map((el, i) => (
          <ElementMarker
            key={i}
            element={el}
            stackIndex={stackIndices[i] ?? 0}
          />
        ))}
      </div>

      {/* Element list */}
      <div className="space-y-0.5 text-[10px] leading-tight text-neutral-400">
        {slide.elements.map((el, i) => (
          <div key={i} className="flex items-baseline gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${elementDotColor(
                el.type,
              )}`}
              aria-hidden
            />
            <span className="text-neutral-300">{el.type}</span>
            <span className="truncate text-neutral-500">{el.role}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ElementMarker({
  element,
  stackIndex,
}: {
  element: LayoutElement
  stackIndex: number
}) {
  // Map region → grid cell coordinates (col/row in the 3×3) or special handling.
  const pos = regionToBox(element.region, element.size)
  if (!pos) return null

  // Offset stacked markers by a few pixels so each is partially visible.
  // Full-bleed gets no offset — it should always span the whole canvas;
  // a stack of full-bleeds just means later ones paint on top, which
  // visually conveys the layering anyway.
  const shouldOffset = stackIndex > 0 && element.region !== 'full-bleed'
  const offsetPx = shouldOffset ? stackIndex * 6 : 0

  return (
    <div
      className={`absolute flex items-center justify-center rounded-sm border border-neutral-700/80 ${elementBgColor(
        element.type,
      )} text-[8px] uppercase tracking-wide text-neutral-100/80`}
      style={{
        ...pos,
        transform: offsetPx > 0 ? `translate(${offsetPx}px, ${offsetPx}px)` : undefined,
        // Stacking order follows array order — later elements paint above
        // earlier ones, matching the convention that elements listed later
        // in the model output are visually higher on the slide.
        zIndex: stackIndex + 1,
      }}
      title={`${element.type} · ${element.role}${element.notes ? ` · ${element.notes}` : ''}`}
    >
      {abbrevType(element.type)}
    </div>
  )
}

/**
 * Convert a region + size into a CSS-percentage box on the 3×3 grid.
 * Returns null if we don't know how to render it (shouldn't happen).
 */
function regionToBox(
  region: LayoutElement['region'],
  size: LayoutElement['size'],
): { top: string; left: string; width: string; height: string } | null {
  if (region === 'full-bleed') {
    return { top: '4%', left: '4%', width: '92%', height: '92%' }
  }
  if (region === 'overlay') {
    // Drop overlays in the center-ish area, smaller than full
    return { top: '38%', left: '38%', width: '24%', height: '24%' }
  }
  // Parse "<vertical>-<horizontal>"
  const [v, h] = region.split('-') as [
    'top' | 'middle' | 'bottom',
    'left' | 'center' | 'right',
  ]
  const colStart = h === 'left' ? 0 : h === 'center' ? 1 : 2
  const rowStart = v === 'top' ? 0 : v === 'middle' ? 1 : 2

  // Expand size by widening the box around its anchor cell
  const cellsByCol: Record<typeof size, number> = {
    small: 1,
    medium: 1.5,
    large: 2,
    full: 3,
  }
  const cellsByRow: Record<typeof size, number> = {
    small: 0.8,
    medium: 1,
    large: 1.4,
    full: 3,
  }
  const widthCells = cellsByCol[size] ?? 1
  const heightCells = cellsByRow[size] ?? 1

  const left = Math.max(0, Math.min(3 - widthCells, colStart + 0.5 - widthCells / 2))
  const top = Math.max(0, Math.min(3 - heightCells, rowStart + 0.5 - heightCells / 2))

  return {
    left: `${(left / 3) * 100}%`,
    top: `${(top / 3) * 100}%`,
    width: `${(widthCells / 3) * 100}%`,
    height: `${(heightCells / 3) * 100}%`,
  }
}

function elementBgColor(type: LayoutElement['type']): string {
  switch (type) {
    case 'headline':
      return 'bg-amber-500/40'
    case 'body':
      return 'bg-neutral-400/30'
    case 'image':
      return 'bg-sky-500/30'
    case 'callout':
      return 'bg-rose-500/40'
    case 'number':
      return 'bg-emerald-500/40'
    case 'decoration':
      return 'bg-neutral-600/30'
    case 'logo':
      return 'bg-violet-500/40'
    case 'badge':
      return 'bg-fuchsia-500/40'
    case 'quote':
      return 'bg-teal-500/40'
    default:
      return 'bg-neutral-500/30'
  }
}

function elementDotColor(type: LayoutElement['type']): string {
  switch (type) {
    case 'headline':
      return 'bg-amber-400'
    case 'body':
      return 'bg-neutral-400'
    case 'image':
      return 'bg-sky-400'
    case 'callout':
      return 'bg-rose-400'
    case 'number':
      return 'bg-emerald-400'
    case 'decoration':
      return 'bg-neutral-500'
    case 'logo':
      return 'bg-violet-400'
    case 'badge':
      return 'bg-fuchsia-400'
    case 'quote':
      return 'bg-teal-400'
    default:
      return 'bg-neutral-500'
  }
}

function abbrevType(type: LayoutElement['type']): string {
  switch (type) {
    case 'headline':
      return 'H'
    case 'body':
      return 'B'
    case 'image':
      return 'IMG'
    case 'callout':
      return 'C'
    case 'number':
      return '#'
    case 'decoration':
      return '·'
    case 'logo':
      return 'L'
    case 'badge':
      return 'BG'
    case 'quote':
      return 'Q'
    default:
      return '?'
  }
}

function ColorSwatch({
  hex,
  kind,
}: {
  hex: string
  kind: 'primary' | 'accent'
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-6 w-6 rounded border border-neutral-700"
        style={{ backgroundColor: hex }}
        aria-label={`${kind} color ${hex}`}
      />
      <span className="font-mono text-[10px] text-neutral-400">{hex}</span>
    </div>
  )
}

function FontGuessList({ guesses }: { guesses: FontGuess[] }) {
  if (guesses.length === 0) {
    return (
      <div className="mt-0.5 text-xs text-neutral-500">
        No specific match — using category fallback
      </div>
    )
  }
  return (
    <ol className="mt-0.5 space-y-0.5">
      {guesses.map((g, i) => (
        <li key={i} className="flex items-center gap-2 text-xs">
          <span className="text-neutral-200">{g.family}</span>
          <span className="text-neutral-500">{g.weight}</span>
          {g.style === 'italic' && (
            <span className="text-neutral-500">italic</span>
          )}
          <span className="ml-auto text-[10px] text-neutral-600">
            {Math.round(g.confidence * 100)}%
          </span>
        </li>
      ))}
    </ol>
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

function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
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
  )
}
