/**
 * analyze-layouts prompt + function declaration
 *
 * The system prompt teaches Gemini how to read carousel reference images
 * and produce a structured LayoutSpec — per-slide composition templates
 * plus recurring patterns and a consistency rating. The function
 * declaration forces the output into the schema our app expects.
 *
 * This is the structural counterpart to analyze-reference (which extracts
 * style). The generator consumes both:
 *   - StyleSpec answers "what should it look like"
 *   - LayoutSpec answers "how should it be arranged"
 *
 * Editing rules:
 *   - The schema mirrors `LayoutSpecSchema` in @app/scene. If you change
 *     one, change the other.
 *   - When changing the prompt, bump ANALYZE_LAYOUTS_VERSION too.
 */

import type { FunctionDeclaration } from '@google/genai'

export const ANALYZE_LAYOUTS_VERSION = 'v1.0.0'

export const ANALYZE_LAYOUTS_SYSTEM_PROMPT = `You are a senior layout designer analyzing reference carousels to extract reusable composition templates.

The creator has supplied one or more carousel posts as visual references. Your job is to decompose each slide into a structural template that the generator can replicate — what elements are present, where they sit on the slide, what role they play. The generator will use this LayoutSpec to arrange new slides with the same structural language as the references.

## Critical distinction: structure, not content

You are NOT describing what the slides say or what images they show. You are describing how the slide is composed:
- Which regions of the canvas are used
- What types of elements occupy those regions
- The relative sizing and stacking
- Recurring structural patterns across the slide set

The content (the specific headline text, the specific photo) is the creator's, not yours. Your job is to extract the layout grammar so it can be reapplied to new content.

## What to extract per slide

For each reference slide (in original order), produce a SlideLayout:

### slideIndex and postId

- slideIndex — zero-indexed position of this slide within its source post (slide 1 = index 0)
- postId — pass through the postId you received in the input, so the generator knows which reference a slide came from

### composition

A short label for the slide's structural type. Free-form, but prefer descriptive labels like:
- 'hero' — single dominant element, usually a full-bleed image
- 'centered' — text-centric, headline focused, content in the middle
- 'split' — two distinct regions (left/right or top/bottom)
- 'overlay' — text overlaid on a photo or image
- 'data-card' — large number or stat with supporting text
- 'quote' — pulled quotation treatment
- 'list' — numbered or bulleted enumeration
- 'collage' — multiple overlapping elements
- 'grid' — multiple equal regions

If none of these fit, write your own descriptive label (e.g. 'corner-callout-with-photo'). Keep it concise.

### elements

An array of the visible elements on the slide, in approximate reading order (top-to-bottom, left-to-right). Each element is { type, region, size, role, notes? }.

Element types (pick the closest):
- 'headline' — the dominant text on the slide
- 'body' — secondary text, longer than a headline, used for elaboration
- 'image' — any photograph, illustration, or rendered visual
- 'callout' — a graphical badge, sticker, oval, circle, or shape with text inside it that emphasizes a phrase
- 'number' — a slide number, a stat, or a step indicator displayed prominently
- 'decoration' — purely decorative shapes, lines, ornaments
- 'logo' — a brand mark or wordmark
- 'badge' — a small label like "NEW", "STEP 1", "PART 2" that's not a callout
- 'quote' — a pulled quotation block with special treatment

Regions (pick exactly one per element):
- 'top-left', 'top-center', 'top-right'
- 'middle-left', 'middle-center', 'middle-right'
- 'bottom-left', 'bottom-center', 'bottom-right'
- 'full-bleed' — the element fills the entire slide canvas
- 'overlay' — the element sits ON TOP of another element (used for callouts overlapping images, text over photo, etc)

Use 'full-bleed' when an element clearly fills the whole slide (a background photo, a solid color background that runs to the edge). Use 'overlay' when an element is layered on top of another element rather than occupying its own region.

Size:
- 'small' — minor element, takes up a small share of the slide
- 'medium' — moderate share, secondary to primary elements
- 'large' — major element, one of the visual anchors
- 'full' — fills its region completely or the entire slide

Role:
- Free-form descriptor of what this element does, e.g. "primary headline", "brand sticker", "supporting body text", "hero photo", "step number", "branded callout sticker".

Notes (optional):
- One short phrase describing visual specifics that matter for replication. Examples: "yellow oval", "white text on photo", "circular shape with text inside", "tilted slightly". Keep under 12 words. Do NOT describe the actual content (no "headline says X").

### notes (per slide, optional)

One short observation about anything notable in the slide's composition that the elements list doesn't capture. Skip when not needed.

## Cross-slide synthesis

After extracting each slide, fill three top-level fields:

### consistency

How visually similar are the slides across the entire set?
- 'high' — slides share the same composition, only swapping content (e.g. all centered headlines on photo backgrounds)
- 'medium' — slides share an underlying grammar but vary the composition (e.g. mix of hero and centered slides, but all use the same callout style)
- 'low' — slides differ substantially in composition (intro slide is a hero, body slides are centered, end slide is a CTA card)

For a single-reference single-slide set, consistency is trivially 'high'. For multi-reference sets, judge whether the references could have been from the same designer/brand.

### patterns

Recurring composition patterns observed across slides. Each pattern has:
- name — short descriptive label (e.g. "hero-with-callout", "centered-text-on-photo", "data-stat-card")
- description — one sentence on what defines the pattern
- slideIndices — the indices into the slides array where this pattern appears

Empty array when only one slide is present, or when slides don't share patterns. A pattern is only worth listing if it appears on at least 2 slides — otherwise it's just that slide's composition.

### notes (top-level, optional)

One or two sentences on the overall layout language of the references. Skip if there's nothing distinctive beyond the per-slide breakdown.

## Reasoning approach

Before calling the tool, think through:
1. What does each slide look like structurally? Sketch the regions in your head.
2. What elements are clearly present vs. ambiguous? Be conservative — don't invent elements you're not sure are there.
3. Are there patterns? Two slides with the same composition = pattern. One-off compositions = no pattern.
4. How consistent is the set?

Then return the LayoutSpec via the submit_layout_spec tool. Output via the tool only — no prose response.`

/**
 * Raw JSON Schema for the LayoutSpec tool input. SINGLE SOURCE OF TRUTH
 * for the schema across providers. Mirrors LayoutSpecSchema in
 * @app/scene exactly.
 *
 * Exported so Claude can read from a pristine copy. See the matching
 * comment in analyze-reference.ts for the full rationale — short
 * version: @google/genai mutates tool schemas in place, so Claude
 * must never read .parameters from a tool already passed to Gemini.
 */
// biome-ignore lint/suspicious/noExplicitAny: JSON Schema escape hatch
export const ANALYZE_LAYOUTS_INPUT_SCHEMA: any = {
    type: 'object',
    required: ['slides', 'consistency', 'patterns'],
    properties: {
      slides: {
        type: 'array',
        minItems: 1,
        description: 'Per-slide layout templates, one per reference image, in input order.',
        items: {
          type: 'object',
          properties: {
            slideIndex: {
              type: 'number',
              minimum: 0,
              description: 'Zero-indexed position of this slide within its source post.',
            },
            postId: {
              type: 'string',
              description: 'Pass through the postId from the input.',
            },
            composition: {
              type: 'string',
              description:
                'Short label for the slide composition: hero, centered, split, overlay, data-card, quote, list, collage, grid, or a custom descriptive label.',
            },
            elements: {
              type: 'array',
              description: 'Visible elements in approximate reading order.',
              items: {
                type: 'object',
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
                    description: 'Free-form descriptor: "primary headline", "brand sticker", etc.',
                  },
                  notes: {
                    type: 'string',
                    description:
                      'Optional short visual specifics, e.g. "yellow oval", "tilted". Under 12 words.',
                  },
                },
                required: ['type', 'region', 'size', 'role'],
              },
            },
            notes: {
              type: 'string',
              description: 'Optional one-line observation about this slide\'s composition.',
            },
          },
          required: ['slideIndex', 'composition', 'elements'],
        },
      },
      consistency: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'How visually similar slides are across the set.',
      },
      patterns: {
        type: 'array',
        description:
          'Recurring composition patterns. Only list patterns that appear on 2+ slides.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            slideIndices: {
              type: 'array',
              items: { type: 'number', minimum: 0 },
            },
          },
          required: ['name', 'description', 'slideIndices'],
        },
      },
      notes: {
        type: 'string',
        description:
          'Optional 1-2 sentences on the overall layout language. Skip if nothing distinctive.',
      },
    },
  }

/**
 * Gemini function declaration. We pass a deep clone of the shared
 * schema so the Gemini SDK's in-place normalization doesn't corrupt
 * the canonical constant (which Claude also reads from).
 */
export const ANALYZE_LAYOUTS_TOOL: FunctionDeclaration = {
  name: 'submit_layout_spec',
  description:
    'Return the extracted layout specification — per-slide composition templates plus recurring patterns and a consistency rating.',
  parameters: structuredClone(ANALYZE_LAYOUTS_INPUT_SCHEMA),
}

/**
 * Build the text part of the user content. Image parts are appended
 * separately in the provider, after this text.
 */
export function buildAnalyzeLayoutsUserMessage(input: {
  imageCount: number
  platform?: { platform: string; format: string }
  imageOrder?: Array<{ order: number; postId?: string }>
}): string {
  const lines: string[] = []
  if (input.platform) {
    lines.push(
      `Target platform: ${input.platform.platform} (${input.platform.format} format).`,
    )
  }
  lines.push(
    `Analyzing ${input.imageCount} reference slide${input.imageCount === 1 ? '' : 's'}. Extract per-slide layout templates plus any recurring patterns.`,
  )
  if (input.imageOrder && input.imageOrder.length > 0) {
    lines.push('')
    lines.push('Slide order (use these slideIndex and postId values verbatim):')
    for (let i = 0; i < input.imageOrder.length; i++) {
      const meta = input.imageOrder[i]
      if (!meta) continue
      const postLabel = meta.postId ? ` (postId: ${meta.postId})` : ''
      lines.push(`  Image ${i + 1} → slideIndex ${meta.order}${postLabel}`)
    }
  }
  return lines.join('\n')
}
