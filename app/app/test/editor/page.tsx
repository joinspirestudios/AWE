'use client'

/**
 * Editor route — Next.js entry point.
 *
 * The actual editor logic lives in EditorClient.tsx. We dynamic-import
 * it here with `ssr: false` so the Konva-using code (which transitively
 * requires the native `canvas` package) is never loaded during the
 * server bundle build or the static prerender pass. Without this,
 * Next.js build-time page generation fails with "Cannot find module
 * 'canvas'" — Konva's index-node.js entry point pulls in `canvas` at
 * module-load time, and prerender requires the page module in Node.
 *
 * With `ssr: false`, EditorClient is split into its own client-only
 * chunk that webpack only emits in the client bundle. The cost is a
 * brief loading flash on first navigation (~200ms to fetch the chunk).
 *
 * `dynamic(..., { ssr: false })` can only be called from a Client
 * Component in Next.js 15, which is why this file has 'use client' at
 * the top.
 */

import dynamic from 'next/dynamic'

const EditorClient = dynamic(() => import('./EditorClient'), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="text-sm text-neutral-500">Loading editor…</div>
    </main>
  ),
})

export default function EditorPage() {
  return <EditorClient />
}
