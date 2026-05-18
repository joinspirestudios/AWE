/**
 * analyze-reference prompt + function declaration
 *
 * The system prompt teaches Gemini how to read carousel reference images
 * and produce a structured StyleSpec — colors, typography, layout,
 * background, motifs. The function declaration forces the output into
 * the schema our app expects.
 *
 * Editing rules:
 *   - The schema mirrors `StyleSpecSchema` in @app/scene. If you change
 *     one, change the other.
 *   - When changing the prompt, bump ANALYZE_REFERENCE_VERSION too.
 */

import type { FunctionDeclaration } from '@google/genai'

export const ANALYZE_REFERENCE_VERSION = 'v1.0.0'

export const ANALYZE_REFERENCE_SYSTEM_PROMPT = `You are a senior visual systems designer analyzing reference carousels to extract a portable style specification.

The creator has supplied one or more carousel posts as visual references. Your job is to identify the design system they share: colors, typography, layout patterns, background treatment, and structural motifs. The generator will use this StyleSpec to design new slides that look like they belong with these references.

## What to extract

For every field in the StyleSpec, base your answer on what you actually see in the images. Do not guess based on the genre, the caption, or assumed conventions. If the references are inconsistent, describe the dominant pattern and reflect the variation in slidePattern.

### colors

- primary — the dominant 1 to 4 colors that define the look. The background colors, the main text colors. Hex strings ('#RRGGBB').
- accents — secondary colors used for highlights, callouts, emphasis. Often 0 to 3 colors. May be empty if the references are monochromatic.

Sample colors from the actual pixels — do not approximate.

### typography

- headlineStyle — the broad category of the headline typeface: serif, sans, display, or monospace. Use 'display' for highly stylized fonts that don't fit serif/sans cleanly (e.g. condensed industrial, art-deco, hand-drawn).
- headlineWeight — light, regular, medium, bold, or black. Use what's dominant; if the references mix weights, pick the boldest headline weight.
- bodyStyle — serif or sans (body text rarely uses display or monospace; if it does, pick the closer of the two).
- hierarchy — high-contrast (clear size/weight jump between headline and body) or subtle (similar sizing throughout).
- headlineFontGuesses — up to 3 ranked font candidates for the headline. Top match first. Each candidate is { family: string, weight: integer (100–900), style: 'normal' | 'italic', confidence: 0..1 }. Return [] if you can't identify any specific family with reasonable confidence — the renderer falls back to the category fields.
- bodyFontGuesses — same shape, for body text. Often empty if body text is short or generic.

Font identification rules:
- Use real font family names: 'Inter', 'Helvetica Neue', 'Playfair Display', 'GT America', 'Söhne', 'Times New Roman', etc.
- Confidence below 0.4 = don't include the candidate at all.
- Weight should be the numeric value (400 = regular, 700 = bold).
- Multiple references may use different fonts. Pick the most distinctive one as the top candidate.

### layout

- alignment — left, center, right, or mixed.
- grid — tight (dense, packed elements), loose (lots of whitespace), or asymmetric (deliberate off-grid composition).
- fullBleed — true if images/colors run to the edge of the slide, false if there's a margin/safe-zone around content.

### background

- type — solid, gradient, photo, photo-overlay (photo with a color/dark layer on top), or texture.
- mood — dark (slides read dark), light (slides read light), or high-contrast (slides alternate or split dramatically).

### motifs

Free-form descriptors that capture distinctive elements. Each motif is 2–5 words. Examples:
- 'grainy film texture'
- 'split-panel composition'
- 'oversized numerals'
- 'circular crops'
- 'hand-drawn arrows'
- 'newsprint typography'
- 'subtle drop shadows'

Return up to 6 motifs. Skip generic descriptors that apply to most carousels.

### slidePattern

- consistent — all slides share the same template and visual treatment.
- varied — each slide has a different layout, but they share a style.
- progressive — slides build on each other (e.g. cumulative reveals, step-numbered designs).

## Critical rules

- Base every field on what is actually visible in the images. Don't invent.
- Numbers like color hex codes should match the dominant pixel values, not nearby web-safe colors.
- Font family names must be real, recognizable typefaces. Don't invent 'Custom Sans' — use 'Helvetica Neue' or whatever it most closely resembles, with appropriate confidence.
- If references conflict, the slidePattern should be 'varied' and your other fields should describe the most common pattern.

Call the submit_style_spec function with your structured result. Do not include any text outside the function call.`

/**
 * Gemini function declaration. The parameters schema is JSON Schema; it
 * mirrors StyleSpecSchema in @app/scene exactly.
 */
export const ANALYZE_REFERENCE_TOOL: FunctionDeclaration = {
  name: 'submit_style_spec',
  description:
    'Submit the structured style specification extracted from the reference images. Always call this exactly once.',
  // biome-ignore lint/suspicious/noExplicitAny: Gemini's Schema type doesn't match JSON Schema 1:1, but the API accepts JSON Schema at runtime.
  parameters: {
    type: 'object',
    required: ['colors', 'typography', 'layout', 'background', 'motifs', 'slidePattern'],
    properties: {
      colors: {
        type: 'object',
        required: ['primary', 'accents'],
        properties: {
          primary: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'string',
              description: 'Hex color string like "#RRGGBB"',
            },
          },
          accents: {
            type: 'array',
            maxItems: 6,
            items: {
              type: 'string',
              description: 'Hex color string like "#RRGGBB"',
            },
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
          },
          headlineWeight: {
            type: 'string',
            enum: ['light', 'regular', 'medium', 'bold', 'black'],
          },
          bodyStyle: { type: 'string', enum: ['serif', 'sans'] },
          hierarchy: {
            type: 'string',
            enum: ['high-contrast', 'subtle'],
          },
          headlineFontGuesses: {
            type: 'array',
            maxItems: 3,
            items: fontGuessSchema(),
          },
          bodyFontGuesses: {
            type: 'array',
            maxItems: 3,
            items: fontGuessSchema(),
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
          grid: { type: 'string', enum: ['tight', 'loose', 'asymmetric'] },
          fullBleed: { type: 'boolean' },
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
        maxItems: 6,
        items: {
          type: 'string',
          description: '2–5 word descriptor of a distinctive visual element',
        },
      },
      slidePattern: {
        type: 'string',
        enum: ['consistent', 'varied', 'progressive'],
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: see above
  } as any,
}

// biome-ignore lint/suspicious/noExplicitAny: see above
function fontGuessSchema(): any {
  return {
    type: 'object',
    required: ['family', 'weight', 'style', 'confidence'],
    properties: {
      family: {
        type: 'string',
        description: 'Real font family name, e.g. "Helvetica Neue"',
      },
      weight: {
        type: 'integer',
        minimum: 100,
        maximum: 900,
        description: 'Numeric weight (100, 200, ... 900). 400 = regular, 700 = bold.',
      },
      style: { type: 'string', enum: ['normal', 'italic'] },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: '0..1 confidence in this candidate. Drop candidates below 0.4.',
      },
    },
  }
}

/**
 * Build the text part of the user content. The image parts are appended
 * separately in the provider, after this text.
 */
export function buildAnalyzeReferenceUserMessage(input: {
  imageCount: number
  platform?: { platform: string; format: string }
}): string {
  const lines: string[] = []
  if (input.platform) {
    lines.push(
      `Target platform: ${input.platform.platform} (${input.platform.format} format).`,
    )
  }
  lines.push(
    `Analyzing ${input.imageCount} reference image${input.imageCount === 1 ? '' : 's'} (carousel slides). Extract the shared style specification.`,
  )
  return lines.join('\n')
}
