/**
 * POST /api/synthesize-plan
 *
 * Body:
 *   {
 *     script: ScriptAnalysis,           // required — output of analyze-script
 *     references: Array<{               // required, may be empty
 *       refId: string,
 *       ownerUsername?: string,
 *       style: StyleSpec,
 *       layouts: LayoutSpec,
 *     }>,
 *     platform?: { platform, format }   // optional
 *   }
 *
 * Returns:
 *   {
 *     plan: CarouselPlan,
 *     usage: ProviderUsage
 *   }
 *
 * This is the synthesis step — fuses script analysis with the references'
 * cached style + layouts analyses into a per-slide design direction.
 * Runs Claude Sonnet primary (reasoning), Gemini fallback.
 */

import { type NextRequest, NextResponse } from 'next/server'
import {
  LayoutSpecSchema,
  PlatformFormatSchema,
  ScriptAnalysisSchema,
  StyleSpecSchema,
} from '@app/scene'
import { z } from 'zod'

import { getRouter } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 180

const RequestSchema = z.object({
  script: ScriptAnalysisSchema,
  references: z
    .array(
      z.object({
        refId: z.string().min(1),
        ownerUsername: z.string().optional(),
        style: StyleSpecSchema,
        layouts: LayoutSpecSchema,
      }),
    )
    .max(8, 'Too many references; cap is 8'),
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
    const result = await router.run('synthesizeCarouselPlan', parsed.data)
    return NextResponse.json({
      plan: result.data,
      usage: result.usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/synthesize-plan]', message)
    return NextResponse.json(
      { error: 'Synthesis failed', message },
      { status: 500 },
    )
  }
}
