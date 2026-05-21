/**
 * POST /api/analyze-reference
 *
 * Take a set of reference image URLs (typically the rehosted Supabase
 * URLs returned by /api/fetch-reference), return a StyleSpec describing
 * the visual design system shared across them.
 *
 * Body:
 *   {
 *     images: Array<{ src: string, order: number, postId?: string }>,
 *     platform?: PlatformFormat
 *   }
 *
 * Returns:
 *   {
 *     styleSpec: StyleSpec,
 *     usage: ProviderUsage
 *   }
 */

import { type NextRequest, NextResponse } from 'next/server'
import { PlatformFormatSchema } from '@app/scene'
import { z } from 'zod'

import { getRouter } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 180

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
    .max(50, 'Too many images (max 50)'),
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
    // Surface the specific validation issue so the UI shows something
    // actionable ("images: Too many images (max 50)") instead of a
    // generic "Invalid request".
    const message = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'request'}: ${i.message}`)
      .join('; ')
    return NextResponse.json(
      { error: 'Invalid request', message, details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const router = getRouter()
    const result = await router.run('analyzeReference', parsed.data)
    return NextResponse.json({
      styleSpec: result.data,
      usage: result.usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/analyze-reference]', message)
    return NextResponse.json(
      { error: 'Analysis failed', message },
      { status: 500 },
    )
  }
}
