/**
 * POST /api/analyze-script
 *
 * Body:
 *   {
 *     script: string,                // required
 *     referenceSlideCount?: number,  // optional
 *     platform?: { platform, format } // optional
 *   }
 *
 * Returns:
 *   {
 *     analysis: ScriptAnalysis,
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
  script: z.string().min(10, 'Script is too short').max(20_000, 'Script is too long'),
  referenceSlideCount: z.number().int().min(1).max(20).optional(),
  platform: PlatformFormatSchema.optional(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    )
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
    const result = await router.run('analyzeScript', parsed.data)
    return NextResponse.json({
      analysis: result.data,
      usage: result.usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/analyze-script]', message)
    return NextResponse.json(
      { error: 'Analysis failed', message },
      { status: 500 },
    )
  }
}
