/**
 * POST /api/fetch-reference
 *
 * Take a social-post URL, return rehosted carousel images and a
 * reference object that can be saved to the scene model directly.
 *
 * Flow:
 *   1. Parse + validate the URL
 *   2. Detect platform (Instagram / LinkedIn / TikTok)
 *   3. Call Apify to scrape image URLs
 *   4. Download each image and re-upload to Supabase Storage
 *   5. Return the reference object plus telemetry
 *
 * Body:   { url: string }
 * Returns: { reference, meta }
 */

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { detectPlatform, scrapeInstagramPost } from '@/lib/apify'
import {
  generateReferenceId,
  rehostCarousel,
} from '@/lib/storage'

export const runtime = 'nodejs'
export const maxDuration = 60

const RequestSchema = z.object({
  url: z.string().url('Must be a valid URL'),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { url } = parsed.data
  const platform = detectPlatform(url)
  if (!platform) {
    return NextResponse.json(
      {
        error:
          'Unsupported URL. Must be an Instagram, LinkedIn, or TikTok post URL.',
      },
      { status: 400 },
    )
  }

  // V1: Instagram only. LinkedIn and TikTok return 501 so the UI can show
  // a clear "coming soon" rather than a generic error.
  if (platform !== 'instagram') {
    return NextResponse.json(
      {
        error: `${platform} scraping is not implemented yet. Try an Instagram post URL for now, or use the manual upload path.`,
      },
      { status: 501 },
    )
  }

  try {
    const scraped = await scrapeInstagramPost(url)

    const referenceId = generateReferenceId()
    const rehost = await rehostCarousel(scraped.imageUrls, referenceId)

    if (rehost.images.length === 0) {
      return NextResponse.json(
        {
          error: 'All image rehost attempts failed',
          details: rehost.errors,
        },
        { status: 502 },
      )
    }

    // Shape matches `meta.references[]` in the scene model so the caller
    // can store this directly on a CarouselDocument.
    const reference = {
      id: referenceId,
      sourceUrl: scraped.sourceUrl,
      sourcePlatform: scraped.platform,
      images: rehost.images.map(({ src, order }) => ({ src, order })),
      uploadedAt: new Date().toISOString(),
    }

    return NextResponse.json({
      reference,
      meta: {
        caption: scraped.caption,
        ownerUsername: scraped.ownerUsername,
        apifyDurationMs: scraped.durationMs,
        apifyCostUsd: scraped.estimatedCostUsd,
        rehostDurationMs: rehost.durationMs,
        totalImagesFound: scraped.imageUrls.length,
        totalImagesRehosted: rehost.images.length,
        errors: rehost.errors,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/fetch-reference]', message)
    return NextResponse.json(
      { error: 'Fetch failed', message },
      { status: 500 },
    )
  }
}
