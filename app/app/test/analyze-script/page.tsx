'use client'

/**
 * /test/analyze-script
 *
 * Validation surface for the analyzeScript pipeline.
 * Paste a script, hit Analyze, see structured output rendered as
 * slide cards plus the raw JSON and usage stats.
 *
 * This is a developer-facing tool — not part of the real funnel UX.
 * It exists so we can iterate on the prompt with confidence.
 */

import { useState } from 'react'

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

interface ResponseShape {
  analysis: AnalysisOutput
  usage: UsageOutput
}

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

/**
 * Renders the headline with `emphasis` substrings visually highlighted.
 * Matches substrings greedily, case-sensitive (since the model is
 * instructed to return exact substrings).
 */
function HighlightedHeadline({
  text,
  emphasis,
}: {
  text: string
  emphasis: string[]
}) {
  if (!emphasis.length) return <>{text}</>

  // Build a regex that matches any of the emphasis substrings.
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

export default function TestAnalyzeScriptPage() {
  const [script, setScript] = useState('')
  const [referenceSlideCount, setReferenceSlideCount] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<ResponseShape | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  async function handleAnalyze() {
    if (!script.trim()) return
    setLoading(true)
    setError(null)
    setResponse(null)
    try {
      const body: Record<string, unknown> = { script }
      if (referenceSlideCount) {
        const n = Number.parseInt(referenceSlideCount, 10)
        if (Number.isFinite(n)) body.referenceSlideCount = n
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
      setResponse(data as ResponseShape)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Test: analyzeScript
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Paste a script. The model returns a structured slide breakdown.
            Click an example below to populate, or write your own.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          {/* INPUT COLUMN */}
          <section className="space-y-4">
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
              className="h-96 w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900 p-4 font-mono text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            />

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-neutral-400">
                Reference slide count
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={referenceSlideCount}
                  onChange={(e) => setReferenceSlideCount(e.target.value)}
                  placeholder="auto"
                  className="w-20 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
                />
              </label>

              <button
                type="button"
                onClick={handleAnalyze}
                disabled={loading || !script.trim()}
                className="ml-auto rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
              >
                {loading ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>

            <p className="text-xs text-neutral-500">
              Characters: {script.length.toLocaleString()}
            </p>
          </section>

          {/* OUTPUT COLUMN */}
          <section className="min-h-[24rem] space-y-4">
            {error && (
              <div className="rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
                <strong>Error:</strong> {error}
              </div>
            )}

            {loading && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-400">
                Calling Claude…
              </div>
            )}

            {!response && !loading && !error && (
              <div className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
                Output will appear here.
              </div>
            )}

            {response && (
              <>
                {/* Carousel-level fields */}
                <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <Field label="Niche" value={response.analysis.niche} />
                    <Field
                      label="Sub-niche"
                      value={response.analysis.subNiche ?? '—'}
                    />
                    <Field label="Tone" value={response.analysis.tone} />
                    <Field label="Audience" value={response.analysis.audience} />
                  </div>
                  <div className="mt-3 border-t border-neutral-800 pt-3 text-sm text-neutral-400">
                    Recommended slides:{' '}
                    <span className="text-neutral-100">
                      {response.analysis.recommendedSlideCount}
                    </span>
                  </div>
                </div>

                {/* Slide cards */}
                <div className="space-y-3">
                  {response.analysis.slides.map((slide, i) => (
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
                        <p className="mt-2 text-sm text-neutral-400">
                          {slide.body}
                        </p>
                      )}
                      {slide.emphasis.length > 0 && (
                        <div className="mt-2 text-xs text-neutral-500">
                          Emphasis: {slide.emphasis.join(' · ')}
                        </div>
                      )}
                    </article>
                  ))}
                </div>

                {/* Usage stats */}
                <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Stat label="Model" value={response.usage.model} />
                    <Stat
                      label="Latency"
                      value={`${response.usage.durationMs} ms`}
                    />
                    <Stat
                      label="Input tokens"
                      value={response.usage.inputTokens?.toLocaleString() ?? '—'}
                    />
                    <Stat
                      label="Output tokens"
                      value={
                        response.usage.outputTokens?.toLocaleString() ?? '—'
                      }
                    />
                    <Stat
                      label="Est. cost"
                      value={`$${response.usage.estimatedCostUsd?.toFixed(5) ?? '0'}`}
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
                    {JSON.stringify(response, null, 2)}
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
