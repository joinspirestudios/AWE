/**
 * Apify scraper wrappers.
 *
 * For now, only Instagram is implemented. LinkedIn and TikTok have
 * different actor shapes and pricing; we'll add them when needed.
 *
 * Strategy: use Apify's `run-sync-get-dataset-items` endpoint to run the
 * actor synchronously and get back the dataset items in a single HTTP
 * call. We set an explicit timeout so we don't burn a 60s Vercel
 * function on a slow run.
 */

import 'server-only'

/**
 * Per-result cost of the official Apify instagram-scraper actor.
 * Approx $2.30 per 1,000 results as of 2026-05. Used for telemetry only;
 * actual billing is on the Apify invoice.
 */
const APIFY_IG_COST_PER_RESULT = 2.3 / 1000

/** Default sync-run timeout in seconds. Apify caps at 300; we cap at 45. */
const APIFY_SYNC_TIMEOUT_SEC = 45

export type ScrapedPlatform = 'instagram' | 'linkedin' | 'tiktok'

export interface ScrapedPost {
  /** Original post URL the user pasted. */
  sourceUrl: string
  /** Platform the post is from. */
  platform: ScrapedPlatform
  /** Original CDN URLs of carousel images (or the single post image). */
  imageUrls: string[]
  /** Optional caption, useful as auxiliary context for the reference review screen. */
  caption?: string
  /** Optional poster handle, useful for attribution in the UI. */
  ownerUsername?: string
  /** Total ms spent in the Apify call (HTTP + actor execution). */
  durationMs: number
  /** Estimated USD cost (telemetry only). */
  estimatedCostUsd: number
}

/**
 * Detect which platform a URL belongs to. Returns null for unsupported
 * domains.
 */
export function detectPlatform(url: string): ScrapedPlatform | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (host.endsWith('instagram.com') || host === 'instagram.com') return 'instagram'
  if (host.endsWith('linkedin.com') || host === 'linkedin.com') return 'linkedin'
  if (host.endsWith('tiktok.com') || host === 'tiktok.com') return 'tiktok'
  return null
}

/**
 * Fetch images from an Instagram post URL via Apify.
 * Handles carousels (Sidecar) and single-image posts.
 */
export async function scrapeInstagramPost(
  url: string,
): Promise<ScrapedPost> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) {
    throw new Error('APIFY_API_TOKEN is not set')
  }

  const start = Date.now()

  // Apify's sync endpoint: runs the actor and returns dataset items in
  // one HTTP call. The `~` in the actor name is the user/name separator.
  const endpoint = new URL(
    'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items',
  )
  endpoint.searchParams.set('token', token)
  endpoint.searchParams.set('timeout', String(APIFY_SYNC_TIMEOUT_SEC))

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      directUrls: [url],
      resultsType: 'posts',
      resultsLimit: 1,
      addParentData: false,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(
      `Apify request failed (${response.status}): ${errorBody.slice(0, 300)}`,
    )
  }

  const items = (await response.json()) as unknown
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      'Apify returned no results. The post may be private, deleted, or the URL invalid.',
    )
  }

  const post = items[0] as Record<string, unknown>
  const imageUrls = extractImageUrls(post)
  if (imageUrls.length === 0) {
    throw new Error(
      'Apify returned a post with no extractable images (may be a video-only post).',
    )
  }

  return {
    sourceUrl: url,
    platform: 'instagram',
    imageUrls,
    caption: typeof post.caption === 'string' ? post.caption : undefined,
    ownerUsername:
      typeof post.ownerUsername === 'string' ? post.ownerUsername : undefined,
    durationMs: Date.now() - start,
    estimatedCostUsd: APIFY_IG_COST_PER_RESULT,
  }
}

/**
 * Extract image URLs from an Apify Instagram post object. Apify returns
 * different shapes depending on post type:
 *
 * - Carousel (Sidecar): `images: string[]` — the carousel slides in order
 * - Carousel (older): `sidecarChildren: { displayUrl }[]`
 * - Single image: `displayUrl: string`
 *
 * We try each in order and skip videos.
 */
function extractImageUrls(post: Record<string, unknown>): string[] {
  // Carousel post (newer Apify shape)
  if (Array.isArray(post.images) && post.images.length > 0) {
    return (post.images as unknown[]).filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    )
  }

  // Carousel post (older shape)
  if (
    Array.isArray(post.sidecarChildren) &&
    (post.sidecarChildren as unknown[]).length > 0
  ) {
    return (post.sidecarChildren as Array<Record<string, unknown>>)
      .filter((c) => !c.isVideo)
      .map((c) => c.displayUrl)
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
  }

  // Single image post
  if (typeof post.displayUrl === 'string' && post.displayUrl.length > 0) {
    // Skip if it's a video — we only want image references for now.
    if (post.isVideo === true) return []
    return [post.displayUrl]
  }

  return []
}
