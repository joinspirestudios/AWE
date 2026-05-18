'use client'

/**
 * /test/fetch-reference
 *
 * Validation surface for the Apify + Supabase Storage pipeline.
 * Paste an Instagram post URL, hit Fetch, watch the carousel images
 * rehost into your Supabase bucket and render below.
 *
 * Developer tool — not the real funnel UX.
 */

import { useState } from 'react'

interface RehostedImage {
  src: string
  order: number
}

interface Reference {
  id: string
  sourceUrl: string
  sourcePlatform: string
  images: RehostedImage[]
  uploadedAt: string
}

interface FetchMeta {
  caption?: string
  ownerUsername?: string
  apifyDurationMs: number
  apifyCostUsd: number
  rehostDurationMs: number
  totalImagesFound: number
  totalImagesRehosted: number
  errors: Array<{ order: number; originalUrl: string; message: string }>
}

interface ResponseShape {
  reference: Reference
  meta: FetchMeta
}

const EXAMPLE_URLS = [
  // The user will paste their own; these are placeholders that show the
  // shape of URLs the endpoint accepts.
  'https://www.instagram.com/p/SHORT_CODE/',
]

export default function TestFetchReferencePage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<ResponseShape | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  async function handleFetch() {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    setResponse(null)
    try {
      const res = await fetch('/api/fetch-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
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
            Test: fetch-reference
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Paste an Instagram post URL. We scrape it via Apify, download
            each carousel image, and rehost to Supabase Storage so the URLs
            stay valid forever.
          </p>
        </header>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.instagram.com/p/..."
              className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleFetch}
              disabled={loading || !url.trim()}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
            >
              {loading ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            Supported: Instagram post URLs (carousel or single). LinkedIn /
            TikTok scraping coming soon.
          </p>
        </section>

        <section className="mt-6 min-h-[12rem] space-y-4">
          {error && (
            <div className="rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
              <strong>Error:</strong> {error}
            </div>
          )}

          {loading && (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-400">
              Scraping via Apify and rehosting images… can take 10–30
              seconds.
            </div>
          )}

          {response && (
            <>
              {/* Telemetry */}
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat
                    label="Images found"
                    value={String(response.meta.totalImagesFound)}
                  />
                  <Stat
                    label="Images rehosted"
                    value={String(response.meta.totalImagesRehosted)}
                  />
                  <Stat
                    label="Apify"
                    value={`${response.meta.apifyDurationMs} ms · $${response.meta.apifyCostUsd.toFixed(4)}`}
                  />
                  <Stat
                    label="Rehost"
                    value={`${response.meta.rehostDurationMs} ms`}
                  />
                </div>
                {response.meta.ownerUsername && (
                  <div className="mt-3 border-t border-neutral-800 pt-3 text-sm text-neutral-400">
                    By{' '}
                    <span className="text-neutral-100">
                      @{response.meta.ownerUsername}
                    </span>
                  </div>
                )}
                {response.meta.caption && (
                  <details className="mt-3 border-t border-neutral-800 pt-3">
                    <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-300">
                      Caption
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">
                      {response.meta.caption}
                    </p>
                  </details>
                )}
              </div>

              {/* Image grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {response.reference.images.map((img) => (
                  <figure
                    key={img.order}
                    className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.src}
                      alt={`Reference slide ${img.order + 1}`}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                    <figcaption className="px-3 py-2 text-xs text-neutral-500">
                      Slide {String(img.order + 1).padStart(2, '0')}
                    </figcaption>
                  </figure>
                ))}
              </div>

              {/* Errors */}
              {response.meta.errors.length > 0 && (
                <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-4 text-sm text-amber-200">
                  <strong>Partial failure:</strong>{' '}
                  {response.meta.errors.length} of{' '}
                  {response.meta.totalImagesFound} images couldn't be rehosted.
                  <ul className="mt-2 space-y-1 text-xs">
                    {response.meta.errors.map((e) => (
                      <li key={e.order}>
                        Slide {e.order + 1}: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Reference object */}
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className="text-xs text-neutral-500 underline hover:text-neutral-300"
              >
                {showRaw ? 'Hide' : 'Show'} reference JSON (drops into
                scene.meta.references)
              </button>
              {showRaw && (
                <pre className="overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs text-neutral-300">
                  {JSON.stringify(response.reference, null, 2)}
                </pre>
              )}
            </>
          )}

          {!response && !loading && !error && (
            <div className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
              Paste an Instagram post URL above to test the pipeline.
            </div>
          )}
        </section>
      </div>
    </main>
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
