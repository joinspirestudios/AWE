/**
 * POST /api/analyze-layouts
 *
 * Take a set of reference image URLs (typically the rehosted Supabase
 * URLs returned by /api/fetch-reference), return a LayoutSpec describing
 * per-slide composition templates plus recurring patterns.
 *
 * This is the structural counterpart to /api/analyze-reference. The page
 * calls both in parallel against the same images — they produce the two
 * inputs the generator needs (StyleSpec + LayoutSpec).
 *
 * Body:
 *   {
 *     images: Array<{ src: string, order: number, postId?: string }>,
 *     platform?: PlatformFormat
 *   }
 *
 * Returns:
 *   {
 *     layoutSpec: LayoutSpec,
 *     usage: ProviderUsage
 *   }
 */

import { type NextRequest, NextResponse } from 'next/server'
import { PlatformFormatSchema } from '@app/scene'
import { z } from 'zod'

import { getRouter } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 60

const RequestSchema = z.object({
  images: z
    .array(
      z.object({
        src: z.string().url(),
        order: z.number().int().min(0),
        postId: z.string().optional(),
      }),
    )
    .min(1, 'At least one image is required')
    .max(24, 'Too many images (max 24)'),
  platform: PlatformFormatSchema.optional(),
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

  try {
    const router = getRouter()
    const result = await router.run('analyzeLayouts', parsed.data)
    return NextResponse.json({
      layoutSpec: result.data,
      usage: result.usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/analyze-layouts]', message)
    return NextResponse.json(
      { error: 'Analysis failed', message },
      { status: 500 },
    )
  }
}
