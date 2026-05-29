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

export const SYNTHESIZE_CAROUSEL_PLAN_VERSION = 'v1.2.0'

export const SYNTHESIZE_CAROUSEL_PLAN_SYSTEM_PROMPT = `You are a senior creative director synthesizing per-slide design direction for a creator's carousel, drawing on visual references they've provided.

## What you receive

You'll see:

1. **Script analysis** — the creator's N script slides, each with a purpose (hook / point / data / quote / comparison / step / cta) and the actual headline + body text.
2. **References** — 1-4 reference carousels the creator chose as inspiration. Each reference comes with:
   - A **StyleSpec** describing its visual style (colors, typography, layout grammar, motifs).
   - A **LayoutSpec** describing its per-slide composition templates and any recurring patterns across slides.

## What you produce

A **CarouselPlan** with two parts:

1. A unified **style** — colors, typography, layout grammar, background type/mood, motifs, and slide-pattern decision — that defines the visual identity for the entire carousel. *One* style for all slides, synthesized from the references and the script's tone.
2. One **SlidePlan** per script slide — the per-slide design decision: composition label, element placements, rationale, and drawsFrom citations.

Plus optional **overview** prose tying it together.

## How to think about the unified style

You're not picking a reference and copying it. You're deciding what *this carousel* should look like, informed by the references but committed to a single coherent identity.

For each style field, decide deliberately:

- **colors.primary / accents** — usually inherit from the references (creators reuse brand colors). When references conflict, pick the palette that fits the script's tone — confident-direct sells with bolder colors; thoughtful-educational sells with muted ones.
- **typography** — pick category (serif/sans/display/monospace) + weight + hierarchy. If a specific font family recurs across reference's headlineFontGuesses, surface it in headlineFontGuesses with high confidence; otherwise leave the array empty and let the renderer fall back.
- **layout** — alignment, grid density, fullBleed. If the references are mixed, lean toward what the script needs (data-heavy scripts want loose grids; quote/hook-heavy scripts can take tight).
- **background.type / mood** — the dominant background treatment. Per-slide variations (e.g., the CTA goes dark-photo-overlay while the rest are texture) are expressed in each SlidePlan's composition, not by overriding the unified style.
- **motifs** — the carousel's identity beats. Free-form short phrases: "grainy film texture", "oval callout stickers", "big numerals", "split-panel".
- **slidePattern** — consistent (template-like), varied (each slide its own visual idea), or progressive (an arc builds across slides).

## How to think about per-slide plans

You are translating the creator's content (script) into the design language of the unified style you just set. Each script slide's purpose drives the composition choice; the composition choice draws on what the references have shown is appropriate within that style.

For every slide:

- **composition**: pick a label that matches what's structurally happening. Use the references' composition vocabulary when something fits — "hero", "centered", "split", "overlay", "data-card", "quote-pull", "step-numbered", "callout", "list", "collage". Invent new labels only when nothing in the references applies.
- **elements**: prescribe element placements that fit the composition. Match the references' grammar: if every reference slide uses a centered headline + bottom-left callout, your slides should too unless the script demands otherwise. Use the same type vocabulary as LayoutSpec (headline, body, image, callout, number, decoration, logo, badge, quote).
- **element content (CRITICAL)**: every text-bearing element MUST carry its own 'content' field — the literal words it displays. Distribute the slide's script content across its slots; never repeat the whole headline or body in multiple slots. If a slide has two headline elements for a contrast, split the idea: one gets the first concept, the other gets the second. If it has two body columns, each gets only its side's text. If it has a bullet list rendered as multiple body elements, each element gets ONE distinct bullet. A concluding-statement slot gets just the takeaway sentence. The content must be display-ready: no markdown, no leading dashes, tight phrasing that fits the slot. This is how the rendered slide ends up with the right words in the right places instead of duplicated text.
- **rationale**: 1-2 sentences explaining the design choice. Reference both the slide's purpose ("this is a data slide, so the metric needs to dominate") and the reference language ("matching the data-card pattern from reference 1, where the numeral fills the upper half").
- **drawsFrom**: when a specific reference slide or pattern directly informs the plan, cite it. Empty when the slide is a natural synthesis without a single inspiration source.

## Matching purpose to composition

The script's purpose tells you what each slide needs to *do*. Composition should serve that purpose:

- **hook** — high contrast, minimal copy, maximum stopping power. Keep the headline short and emphasize ONE token the way the references emphasize it (a highlighted word, a size jump, a color swatch — whatever they actually do). Don't blow a full sentence up to headline size unless the references do exactly that.
- **point** — the workhorse slide. The idea, composed the way the references compose their body slides.
- **data** — the metric is the focal point. Large numeral, supporting text small. Often centered or upper-half-dominant.
- **quote** — pulled quotation centerpiece, attribution small. Often with quote marks as decoration.
- **comparison** — signal the duality the way the references do it: side-by-side columns, stacked color-coded blocks, before/after — mirror their method. The one thing to avoid is rendering two full sentences as two giant side-by-side headlines (a common failure) unless the references genuinely do that.
- **step** — numbered, sequenced. The step number is itself an element.
- **cta** — emphasis on the action, composed the way the references close their carousels.

## Output toolbox (how text becomes design)

You have a set of tools for turning text into design. **Use the ones the references actually exhibit — do not impose any of them by default.** If the references float large headlines on open space, do that; if they seat text in colored blocks, do that. Read the references' motifs, layout, and per-slide structure and mirror their method.

1. **container** ('band' = filled rectangle, text reverses on the fill; 'box' = thin border, transparent inside): use ONLY when the references seat concept text inside filled bands or bordered boxes. Many business/editorial carousels do; many photo-led or big-type carousels do NOT. This is a tool, not a requirement.

2. **label + content**: when a block leads with a bold concept name and continues in regular weight, put the bold part in 'label' (1–3 words) and the remainder in 'content'. The renderer renders the label heavier at the SAME size. Use only when the references show this lead-in pattern.

3. **tone** ('accent' | 'dark' | 'neutral'): colors a container from the palette. If the references color-code two recurring ideas, assign consistent tones across slides so the set feels authored.

4. **emphasis method — match the references.** Emphasis may come from WEIGHT + COLOR at a uniform size, OR from SIZE, OR from a highlighted swatch. Do not force one. The only hard rule: do not render long body sentences at headline size when the references keep body text small.

5. **size** should reflect the references' hierarchy — reserve the largest type for whatever they make largest (often a numeral or a 1–4 word hook).

## Composition discipline (applies to every aesthetic)

- **Variety**: don't emit the same composition on more than ~2 consecutive slides unless the references are deliberately uniform ('slidePattern' = 'consistent').
- **Content split**: every text element carries its own 'content' (the literal words), split across slots — never duplicate the whole headline/body into multiple slots.
- **Density is handled downstream**: the renderer derives how much of the canvas to fill from the extracted 'layout' (tight/loose/asymmetric, fullBleed). You don't force compactness or fullness in the plan — set 'layout' to match the references and the renderer obeys it.
- **Footer / logo / decoration**: only add these elements when the references actually show them; never as filler on every slide.

## StyleSpec rules (obey the references, impose nothing)

- **background**: 'colors.primary[0]' IS the rendered background color — order primary so the references' dominant *background* tone is first, whether that is light or dark. Set 'background.mood' to match what the slides actually read as. Never lighten a dark reference or darken a light one.
- **typography**: set 'headlineStyle' / 'bodyStyle' to the category the references actually use — serif, sans, display, or monospace. If a specific family recurs in the references' font guesses, surface it in 'headlineFontGuesses' / 'bodyFontGuesses' (that family is authoritative for the renderer). Do not default to any particular family or category.
- **accents**: carry the references' actual highlight colors into 'colors.accents'; they drive containers and callouts.


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
  required: ['slides', 'style'],
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
                    'Free-form descriptor of the slot\'s PURPOSE: "primary headline", "metric value", "brand sticker", "left concept explanation". This is a label for you to reason with — it is NOT shown to the user.',
                },
                content: {
                  type: 'string',
                  description:
                    'The LITERAL TEXT this element displays, taken/adapted from the script. REQUIRED for text elements (headline, body, quote, callout, number, badge). This is what the user sees. CRITICAL: when a slide splits content across multiple slots, each slot gets its OWN portion — never repeat the whole headline or body in every slot. Example: a hook that contrasts two ideas with two headline elements → left content "Storytelling", right content "Intentional Storytelling" (NOT the full "Storytelling vs Intentional Storytelling" in both). A two-column comparison → left body gets the left side\'s explanation only, right body gets the right side\'s only, a concluding body gets just the takeaway. Keep each slot\'s text tight and display-ready (no markdown, no leading dashes). Omit for purely visual elements (image, decoration, logo).',
                },
                container: {
                  type: 'string',
                  enum: ['band', 'box'],
                  description:
                    "Container treatment for concept text — the reference grammar. 'band' = solid filled rectangle (text reverses to read on the fill); 'box' = thin-bordered, transparent inside. Set this on body/concept elements by DEFAULT; omit only for cover/CTA free-floating text. Without a container the slide looks unfinished.",
                },
                label: {
                  type: 'string',
                  description:
                    'Bold lead-in rendered before content at the SAME size but heavier weight — this is how emphasis works (weight, not size). Put the concept name here (1–3 words), e.g. "Storytelling"; put the remainder in content, e.g. "starts with the event.". Do not restate the label inside content.',
                },
                tone: {
                  type: 'string',
                  enum: ['accent', 'dark', 'neutral'],
                  description:
                    "Color intent for a container. 'accent' = brand accent fill (e.g. gold); 'dark' = near-black fill, light text; 'neutral' = subtle/plain border. Color-code two recurring concepts consistently across slides (e.g. accent='before', dark='after').",
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
    style: {
      type: 'object',
      description:
        'Unified visual style for the entire carousel — synthesized across the references and the script\'s tone, not copied from any one reference. Drives every slide\'s render.',
      required: [
        'colors',
        'typography',
        'layout',
        'background',
        'motifs',
        'slidePattern',
      ],
      properties: {
        colors: {
          type: 'object',
          required: ['primary', 'accents'],
          properties: {
            primary: {
              type: 'array',
              minItems: 1,
              description:
                'Primary brand colors as hex strings (e.g. "#FFB200"). At least one. Order them by visual dominance.',
              items: { type: 'string' },
            },
            accents: {
              type: 'array',
              description:
                'Accent colors as hex strings — used for callouts, decorative motifs, secondary emphasis.',
              items: { type: 'string' },
            },
          },
        },
        typography: {
          type: 'object',
          required: [
            'headlineStyle',
            'headlineWeight',
            'bodyStyle',
            'hierarchy',
            'headlineFontGuesses',
            'bodyFontGuesses',
          ],
          properties: {
            headlineStyle: {
              type: 'string',
              enum: ['serif', 'sans', 'display', 'monospace'],
              description: 'Headline typography category.',
            },
            headlineWeight: {
              type: 'string',
              enum: ['light', 'regular', 'medium', 'bold', 'black'],
            },
            bodyStyle: {
              type: 'string',
              enum: ['serif', 'sans'],
              description: 'Body text typography category.',
            },
            hierarchy: {
              type: 'string',
              enum: ['high-contrast', 'subtle'],
              description:
                'How aggressively headline and body should differ in size/weight.',
            },
            headlineFontGuesses: {
              type: 'array',
              maxItems: 3,
              description:
                'Up to 3 ranked headline font candidates, top match first. Empty if no specific family is identifiable.',
              items: {
                type: 'object',
                required: ['family', 'weight', 'confidence'],
                properties: {
                  family: { type: 'string' },
                  weight: { type: 'number' },
                  style: {
                    type: 'string',
                    enum: ['normal', 'italic'],
                  },
                  confidence: { type: 'number' },
                },
              },
            },
            bodyFontGuesses: {
              type: 'array',
              maxItems: 3,
              description: 'Same shape as headlineFontGuesses, for body.',
              items: {
                type: 'object',
                required: ['family', 'weight', 'confidence'],
                properties: {
                  family: { type: 'string' },
                  weight: { type: 'number' },
                  style: {
                    type: 'string',
                    enum: ['normal', 'italic'],
                  },
                  confidence: { type: 'number' },
                },
              },
            },
          },
        },
        layout: {
          type: 'object',
          required: ['alignment', 'grid', 'fullBleed'],
          properties: {
            alignment: {
              type: 'string',
              enum: ['left', 'center', 'right', 'mixed'],
            },
            grid: {
              type: 'string',
              enum: ['tight', 'loose', 'asymmetric'],
            },
            fullBleed: {
              type: 'boolean',
              description: 'Whether content should run to slide edges by default.',
            },
          },
        },
        background: {
          type: 'object',
          required: ['type', 'mood'],
          properties: {
            type: {
              type: 'string',
              enum: ['solid', 'gradient', 'photo', 'photo-overlay', 'texture'],
            },
            mood: {
              type: 'string',
              enum: ['dark', 'light', 'high-contrast'],
            },
          },
        },
        motifs: {
          type: 'array',
          description:
            'Free-form descriptors that capture the carousel\'s visual identity: "grainy texture", "oval callout stickers", "big numerals", "split-panel". 0-8 items.',
          items: { type: 'string' },
        },
        slidePattern: {
          type: 'string',
          enum: ['consistent', 'varied', 'progressive'],
          description:
            'How much the slides vary from each other visually. "consistent" = template-like, "progressive" = builds an arc, "varied" = each is its own visual idea.',
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
  /** Zero-indexed slide positions to regenerate. Empty/absent = full plan. */
  slidesToSynthesize?: number[]
  /** Required when slidesToSynthesize is non-empty. */
  existingPlan?: CarouselPlan
}): string {
  const lines: string[] = []

  // Detect partial mode early — only treat as partial if we have BOTH
  // the slide list AND an existing plan to anchor consistency against.
  const isPartial =
    Array.isArray(input.slidesToSynthesize) &&
    input.slidesToSynthesize.length > 0 &&
    input.existingPlan !== undefined &&
    input.existingPlan.slides.length > 0

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

    // Style summary — keep it compact. Maps to StyleSpecSchema in @app/scene.
    lines.push('### Style')
    if (r.style.colors.primary.length > 0) {
      lines.push(`Primary colors: ${r.style.colors.primary.join(', ')}`)
    }
    if (r.style.colors.accents.length > 0) {
      lines.push(`Accent colors: ${r.style.colors.accents.join(', ')}`)
    }
    // Typography: surface the category fields plus the top font guess
    // for each role when one was identified. Font names are stronger
    // signal than "sans" / "serif" alone — synthesis should be able to
    // call out specific candidates when they recur across references.
    const headlineFont = r.style.typography.headlineFontGuesses[0]
    const bodyFont = r.style.typography.bodyFontGuesses[0]
    const headlineDesc = headlineFont
      ? `${r.style.typography.headlineStyle} (${headlineFont.family})`
      : r.style.typography.headlineStyle
    const bodyDesc = bodyFont
      ? `${r.style.typography.bodyStyle} (${bodyFont.family})`
      : r.style.typography.bodyStyle
    lines.push(
      `Typography: ${headlineDesc} headline / ${bodyDesc} body, ${r.style.typography.headlineWeight} weight, ${r.style.typography.hierarchy} hierarchy`,
    )
    if (r.style.motifs.length > 0) {
      lines.push(`Motifs: ${r.style.motifs.join(', ')}`)
    }
    lines.push(
      `Layout grammar: ${r.style.layout.alignment}-aligned, ${r.style.layout.grid} grid${r.style.layout.fullBleed ? ', full-bleed' : ''}`,
    )
    lines.push(
      `Background: ${r.style.background.type}, ${r.style.background.mood} mood`,
    )
    lines.push(`Slide pattern: ${r.style.slidePattern}`)

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

  if (isPartial && input.existingPlan && input.slidesToSynthesize) {
    // Partial mode: ground the regeneration in the existing plan so the
    // model maintains the visual arc, composition vocabulary, and
    // citation style the user already accepted for the other slides.
    lines.push('# Existing plan (regenerate only specified slides)')
    lines.push('')
    if (input.existingPlan.overview) {
      lines.push(`Overview: ${input.existingPlan.overview}`)
      lines.push('')
    }
    // The existing unified style — must be echoed back unchanged in the
    // response. JSON-dumped because every field matters for the renderer.
    lines.push('Existing unified style (return this verbatim):')
    lines.push('```json')
    lines.push(JSON.stringify(input.existingPlan.style, null, 2))
    lines.push('```')
    lines.push('')
    lines.push('Current plan slides:')
    for (const slide of input.existingPlan.slides) {
      const els = slide.elements
        .map(
          (e) =>
            `${e.type}@${e.region}/${e.size}${e.role ? `(${e.role})` : ''}`,
        )
        .join(', ')
      const draws =
        slide.drawsFrom.length > 0
          ? ` [draws: ${slide.drawsFrom.map((d) => `${d.refId}${d.slideIndex !== undefined ? `#${d.slideIndex}` : ''}/${d.what}`).join(', ')}]`
          : ''
      lines.push(
        `  - Slide ${slide.slideIndex} (${slide.purpose}): ${slide.composition}${els ? ` — [${els}]` : ''}${draws}`,
      )
    }
    lines.push('')
    lines.push(
      `Regenerate ONLY these slides: ${input.slidesToSynthesize.sort((a, b) => a - b).join(', ')}.`,
    )
    lines.push(
      `Return a CarouselPlan containing exactly those SlidePlans, in slideIndex order. Do NOT include unchanged slides. Omit the top-level overview field. The script content for the affected slide(s) may have changed — read the script analysis above carefully; respect the new headline/body/emphasis exactly.`,
    )
    lines.push(
      `Keep the regenerated slides consistent with the rest of the existing plan: same composition vocabulary, same drawsFrom citation style, same level of rationale detail. Don't redesign the whole carousel for one slide.`,
    )
    // Partial mode must still return a valid CarouselPlan, which means
    // a `style` is required. Re-emit the existing plan's style verbatim
    // so the renderer sees no shift on retry.
    lines.push(
      `Include the unified style field as-is from the existing plan above — do not change colors, typography, motifs, or any other style attribute. Style stays stable across per-slide retries.`,
    )
    lines.push('Call submit_carousel_plan with the partial result.')
  } else {
    lines.push(
      `Now produce the CarouselPlan: synthesize the unified style first, then one SlidePlan per script slide (${input.script.recommendedSlideCount} total), in slideIndex order. Call submit_carousel_plan with the result.`,
    )
  }

  return lines.join('\n')
}

/** Narrow runtime helper for asserting the returned object matches our type. */
export function isCarouselPlanLike(value: unknown): value is CarouselPlan {
  if (!value || typeof value !== 'object') return false
  const v = value as { slides?: unknown }
  return Array.isArray(v.slides) && v.slides.length > 0
}
