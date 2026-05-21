/**
 * synthesize-carousel-plan prompt + function declaration
 *
 * The synthesis step that fuses (ScriptAnalysis + N references' StyleSpec
 * + LayoutSpec) into a per-slide CarouselPlan for the user's script. This
 * is what the user sees in the funnel's "Direction" tab — the design
 * decision for each slide of their carousel, before the generator turns
 * it into actual scene objects.
 *
 * Unlike analyze-* prompts (vision-heavy extraction), this is text-only
 * reasoning: read structured analyses, decide per-slide compositions,
 * justify each choice, optionally cite reference patterns.
 *
 * Editing rules:
 *   - The schema mirrors `CarouselPlanSchema` in @app/scene. If you change
 *     one, change the other.
 *   - When changing the prompt, bump SYNTHESIZE_CAROUSEL_PLAN_VERSION too.
 */

import type { FunctionDeclaration } from '@google/genai'
import type {
  CarouselPlan,
  LayoutSpec,
  ScriptAnalysis,
  StyleSpec,
} from '@app/scene'

export const SYNTHESIZE_CAROUSEL_PLAN_VERSION = 'v1.0.0'

export const SYNTHESIZE_CAROUSEL_PLAN_SYSTEM_PROMPT = `You are a senior creative director synthesizing per-slide design direction for a creator's carousel, drawing on visual references they've provided.

## What you receive

You'll see:

1. **Script analysis** — the creator's N script slides, each with a purpose (hook / point / data / quote / comparison / step / cta) and the actual headline + body text.
2. **References** — 1-4 reference carousels the creator chose as inspiration. Each reference comes with:
   - A **StyleSpec** describing its visual style (colors, typography, layout grammar, motifs).
   - A **LayoutSpec** describing its per-slide composition templates and any recurring patterns across slides.

## What you produce

A **CarouselPlan**: one SlidePlan per script slide. Each SlidePlan is the design decision for that slide — what composition it uses, what elements it contains, why, and which references informed it.

## How to think about this

You are not designing in a vacuum. You are translating the creator's content (script) into the design language of their references. Each script slide's purpose should drive the composition choice; each composition choice should draw on what the references have shown is appropriate.

For every slide:

- **composition**: pick a label that matches what's structurally happening. Use the references' composition vocabulary when something fits — "hero", "centered", "split", "overlay", "data-card", "quote-pull", "step-numbered", "callout", "list", "collage". Invent new labels only when nothing in the references applies.
- **elements**: prescribe element placements that fit the composition. Match the references' grammar: if every reference slide uses a centered headline + bottom-left callout, your slides should too unless the script demands otherwise. Use the same type vocabulary as LayoutSpec (headline, body, image, callout, number, decoration, logo, badge, quote).
- **rationale**: 1-2 sentences explaining the design choice. Reference both the slide's purpose ("this is a data slide, so the metric needs to dominate") and the reference language ("matching the data-card pattern from reference 1, where the numeral fills the upper half").
- **drawsFrom**: when a specific reference slide or pattern directly informs the plan, cite it. Empty when the slide is a natural synthesis without a single inspiration source.

## Matching purpose to composition

The script's purpose tells you what each slide needs to *do*. Composition should serve that purpose:

- **hook** — high contrast, minimal copy, maximum stopping power. Often a single bold headline. Reference's most attention-grabbing composition.
- **point** — balanced headline + body. The workhorse slide. Most reference slides will be this.
- **data** — the metric is the focal point. Large numeral, supporting text small. Often centered or upper-half-dominant.
- **quote** — pulled quotation centerpiece, attribution small. Often with quote marks as decoration.
- **comparison** — split treatment. Two columns, before/after, vs framing. The composition signals duality.
- **step** — numbered, sequenced. Step number is itself an element.
- **cta** — button-like emphasis on the action. Often centered with arrow decoration. Last slide pattern.

## When references conflict

If the references have different design languages (e.g., one is editorial, one is meme-style), don't try to blend them into mush. Pick the language that fits the script's tone best, and lean into that one. You can borrow specific patterns from the other reference where they apply (e.g., a callout treatment from ref 2 used on a slide whose composition is otherwise from ref 1).

## When references are sparse

If you only have one reference, replicate its composition language directly across the user's slides. Map each script slide to the closest matching reference slide composition.

## What NOT to do

- Don't describe the slide's text content again — that's already in the script. Your job is the *visual decision*.
- Don't invent design language that doesn't come from the script or references. If the references are minimalist editorial, don't propose a meme overlay.
- Don't write rationale longer than 2 sentences. The user is reading 11+ of these.
- Don't cite drawsFrom when the synthesis is original. Empty drawsFrom is fine and honest.

## Output

Call the submit_carousel_plan tool with the structured CarouselPlan. One slide plan per script slide, in slideIndex order matching the script.
`

/**
 * Canonical JSON Schema for the synthesize_carousel_plan tool. Exported
 * as a constant so Claude (which accepts plain JSON Schema) can use it
 * directly, while Gemini gets a structuredClone (the @google/genai SDK
 * mutates schemas in place — uppercasing enum values etc. — which would
 * corrupt the shared constant). This is the same pattern as
 * analyze-reference and analyze-layouts.
 */
export const SYNTHESIZE_CAROUSEL_PLAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['slides'],
  properties: {
    slides: {
      type: 'array',
      minItems: 1,
      description:
        'One SlidePlan per script slide, in slideIndex order. Length should match the script\'s recommendedSlideCount.',
      items: {
        type: 'object',
        required: ['slideIndex', 'purpose', 'composition', 'elements', 'rationale'],
        properties: {
          slideIndex: {
            type: 'number',
            minimum: 0,
            description: 'Zero-indexed position in the user\'s script slides.',
          },
          purpose: {
            type: 'string',
            description:
              'Slide purpose from script analysis. Use the same value the script analysis provided. Canonical values: hook, point, data, quote, comparison, step, cta.',
          },
          composition: {
            type: 'string',
            description:
              'Composition pattern label. Use the references\' vocabulary when something fits.',
          },
          elements: {
            type: 'array',
            description:
              'Element placements for this slide, in visual reading order.',
            items: {
              type: 'object',
              required: ['type', 'region', 'size', 'role'],
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'headline',
                    'body',
                    'image',
                    'callout',
                    'number',
                    'decoration',
                    'logo',
                    'badge',
                    'quote',
                  ],
                },
                region: {
                  type: 'string',
                  enum: [
                    'top-left',
                    'top-center',
                    'top-right',
                    'middle-left',
                    'middle-center',
                    'middle-right',
                    'bottom-left',
                    'bottom-center',
                    'bottom-right',
                    'full-bleed',
                    'overlay',
                  ],
                },
                size: {
                  type: 'string',
                  enum: ['small', 'medium', 'large', 'full'],
                },
                role: {
                  type: 'string',
                  description:
                    'Free-form descriptor: "primary headline", "metric value", "brand sticker", "supporting body".',
                },
                notes: {
                  type: 'string',
                  description:
                    'Optional notes: "matches reference 1 callout style", "yellow accent shape".',
                },
              },
            },
          },
          rationale: {
            type: 'string',
            description:
              '1-2 sentences explaining the design choice. Reference both the slide\'s purpose and any reference language used.',
          },
          drawsFrom: {
            type: 'array',
            description:
              'Citations: which reference slides informed this plan. Empty array is acceptable when the synthesis is original.',
            items: {
              type: 'object',
              required: ['refId', 'what'],
              properties: {
                refId: {
                  type: 'string',
                  description: 'Reference postId from the input references.',
                },
                slideIndex: {
                  type: 'number',
                  minimum: 0,
                  description: 'Optional reference slide index.',
                },
                what: {
                  type: 'string',
                  description:
                    'What is being borrowed: "hero composition", "callout style", "split treatment".',
                },
              },
            },
          },
        },
      },
    },
    overview: {
      type: 'string',
      description:
        'Optional one-paragraph overview of the carousel\'s overall design direction. Skip if nothing distinctive to say beyond the per-slide rationale.',
    },
  },
}

/**
 * Gemini function declaration. Deep-cloned so the Gemini SDK's in-place
 * normalization doesn't corrupt the canonical constant.
 */
export const SYNTHESIZE_CAROUSEL_PLAN_TOOL: FunctionDeclaration = {
  name: 'submit_carousel_plan',
  description:
    'Return the synthesized per-slide design plan for the creator\'s carousel.',
  parameters: structuredClone(SYNTHESIZE_CAROUSEL_PLAN_INPUT_SCHEMA),
}

/**
 * Build the user message: script analysis + references serialized as a
 * single text payload. Both providers consume the same text — no vision
 * input here.
 */
export function buildSynthesizeCarouselPlanUserMessage(input: {
  script: ScriptAnalysis
  references: Array<{
    refId: string
    ownerUsername?: string
    style: StyleSpec
    layouts: LayoutSpec
  }>
  platform?: { platform: string; format: string }
}): string {
  const lines: string[] = []

  if (input.platform) {
    lines.push(
      `Target platform: ${input.platform.platform} (${input.platform.format}).`,
    )
    lines.push('')
  }

  // Script section
  lines.push('# Script analysis')
  lines.push('')
  lines.push(`Niche: ${input.script.niche}`)
  if (input.script.subNiche) lines.push(`Sub-niche: ${input.script.subNiche}`)
  lines.push(`Tone: ${input.script.tone}`)
  lines.push(`Audience: ${input.script.audience}`)
  lines.push(`Total slides: ${input.script.recommendedSlideCount}`)
  lines.push('')
  lines.push('## Script slides')
  for (let i = 0; i < input.script.slides.length; i++) {
    const s = input.script.slides[i]
    if (!s) continue
    lines.push('')
    lines.push(`### Slide ${i} — ${s.purpose}`)
    lines.push(`Headline: ${s.headline}`)
    if (s.body) lines.push(`Body: ${s.body}`)
    if (s.emphasis.length > 0) {
      lines.push(`Emphasized: ${s.emphasis.join(', ')}`)
    }
  }

  lines.push('')
  lines.push(`# References (${input.references.length})`)
  lines.push('')

  for (let i = 0; i < input.references.length; i++) {
    const r = input.references[i]
    if (!r) continue
    const label = r.ownerUsername ? `@${r.ownerUsername}` : `Reference ${i + 1}`
    lines.push(`## ${label} (refId: ${r.refId})`)
    lines.push('')

    // Style summary — keep it compact
    lines.push('### Style')
    lines.push(`Tone: ${r.style.tone}`)
    if (r.style.colors.brand.length > 0) {
      lines.push(`Brand colors: ${r.style.colors.brand.join(', ')}`)
    }
    if (r.style.colors.accent.length > 0) {
      lines.push(`Accent colors: ${r.style.colors.accent.join(', ')}`)
    }
    lines.push(
      `Typography: ${r.style.typography.headline.style} headline / ${r.style.typography.body.style} body`,
    )
    if (r.style.motifs.length > 0) {
      lines.push(`Motifs: ${r.style.motifs.join(', ')}`)
    }
    lines.push(`Layout grammar: ${r.style.layout.alignment}, ${r.style.layout.grid} grid`)
    if (r.style.slidePattern) {
      lines.push(`Slide pattern: ${r.style.slidePattern}`)
    }

    // Layouts summary — per-slide compositions, then patterns
    lines.push('')
    lines.push('### Layouts')
    lines.push(`Consistency across slides: ${r.layouts.consistency}`)
    if (r.layouts.patterns.length > 0) {
      lines.push('Recurring patterns:')
      for (const p of r.layouts.patterns) {
        lines.push(
          `  - ${p.name}: ${p.description} (slides ${p.slideIndices.join(', ')})`,
        )
      }
    }
    lines.push('Per-slide compositions:')
    for (const sl of r.layouts.slides) {
      const els = sl.elements
        .map((e) => `${e.type}@${e.region}/${e.size}(${e.role})`)
        .join(', ')
      lines.push(
        `  - Slide ${sl.slideIndex}: ${sl.composition}${els ? ` — [${els}]` : ''}${sl.notes ? ` // ${sl.notes}` : ''}`,
      )
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push(
    `Now produce the CarouselPlan: one SlidePlan per script slide (${input.script.recommendedSlideCount} total), in slideIndex order. Call submit_carousel_plan with the result.`,
  )

  return lines.join('\n')
}

/** Narrow runtime helper for asserting the returned object matches our type. */
export function isCarouselPlanLike(value: unknown): value is CarouselPlan {
  if (!value || typeof value !== 'object') return false
  const v = value as { slides?: unknown }
  return Array.isArray(v.slides) && v.slides.length > 0
}
