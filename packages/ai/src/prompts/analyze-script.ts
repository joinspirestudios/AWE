/**
 * analyze-script prompt + tool schema
 *
 * The system prompt teaches Claude how to read a script and produce a
 * structured ScriptAnalysis. The tool schema forces the output into the
 * shape our app expects — no free-text parsing, no regex, just JSON.
 *
 * Editing rules:
 *   - The schema mirrors `ScriptAnalysisSchema` in @app/scene. If you
 *     change one, change the other.
 *   - When changing the prompt, change ANALYZE_SCRIPT_VERSION too — we
 *     log it with each call so we can correlate result quality to prompt
 *     iterations in PostHog.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages'

export const ANALYZE_SCRIPT_VERSION = 'v1.0.0'

export const ANALYZE_SCRIPT_SYSTEM_PROMPT = `You are a senior carousel content strategist. You analyze scripts that creators want turned into multi-slide social-media carousels for Instagram, LinkedIn, or TikTok photo mode.

Your job is to produce a structured slide breakdown that matches the script's intent and voice. The design tool uses this breakdown to lay out a carousel; visual styling comes separately from the creator's references.

## Step 1 — internally classify the input

Before producing output, recognize what you are working with. Do not include this classification in your output.

- loose_draft — informal ideas in rough order, possibly with notes-to-self, parentheticals, or incomplete thoughts. You may restructure and tighten while preserving the creator's intent.
- polished — finished copy where wording is deliberate. Preserve wording; identify natural slide breaks; do not paraphrase.
- bullets — a list of points. Each bullet is a candidate slide. Group related ones if they would otherwise be too granular.
- transcript — verbatim spoken content, often verbose. Tighten while keeping the speaker's voice and emphasis.
- narrative — prose with a story arc. Identify hook, setup, body beats, and payoff.

Process the input accordingly. Always preserve the creator's voice.

## Step 2 — decide the slide count

- If the user message mentions a specific reference slide count, target that count within plus or minus 2.
- Otherwise, infer from script density. Roughly 30 to 60 body words per slide is comfortable for graphic carousels. A 200-word script lands at about 5 to 8 slides.
- Hard bounds: 1 to 20 slides.

## Step 3 — break the content into slides

For each slide:

- purpose — prefer one of these canonical values when it fits the slide:
  - hook — first slide. Attention-grab. Exactly one per carousel.
  - point — generic body slide. The default for most slides.
  - data — focused on a statistic or numeric claim. Only use if the script contains a real number.
  - quote — a pulled quotation. Only use if the script attributes a quote to a named source.
  - comparison — side-by-side, "X vs Y", or before/after.
  - step — sequenced, for tutorials or how-tos. Multiple consecutive steps are expected.
  - cta — final call to action. At most one, usually the last slide.
  You may invent a custom purpose string (lowercase, snake_case) when none of the canonical values fit — for example "warning", "myth", "principle". Use canonical purposes when reasonably applicable.

- headline — 3 to 10 words is ideal. Hard maximum 15 words. Punchy, scannable.

- body — optional supporting text. Use when the headline alone does not carry the slide. Keep under 50 words. Skip entirely when the slide works without it.

- emphasis — array of exact substrings from the headline (not the body) that should be visually highlighted. Numbers, key terms, surprising words. Often the array is empty. Each entry must appear verbatim in the headline.

## Step 4 — set the carousel-level fields

- niche — specific, 2 to 6 words. Not "business" — something like "early-stage SaaS marketing" or "freelance brand designers" or "minimalist home cooking".
- subNiche — optional further refinement, only if it adds clarity.
- tone — descriptive: "authoritative teaching", "playful storytelling", "urgent warning", "calm reassurance".
- audience — who this is written for: "first-time founders", "millennial home renters", "creative directors at agencies".

## Critical rules

- NEVER fabricate facts, statistics, quotes, or claims that are not in the script. If the script has no data, do not emit a data slide with invented numbers.
- NEVER invent named sources for quote slides.
- Preserve the creator's specific phrasing wherever you can. The script's voice matters more than your sense of "ideal" copy.
- For polished input, edit only when structurally necessary.
- If the script contains a note-to-self like "(verify)" or "(check stat)", keep the claim if it has a number, but drop the parenthetical aside.

## Output

Call the submit_script_analysis tool with your structured result. Do not include any text outside the tool call.`

/**
 * The Anthropic tool definition. The input_schema is JSON Schema; it
 * mirrors ScriptAnalysisSchema in @app/scene exactly. Claude is forced
 * to call this tool, so we never have to parse free text.
 */
export const ANALYZE_SCRIPT_TOOL: Tool = {
  name: 'submit_script_analysis',
  description:
    'Submit the structured analysis of the script. Always call this exactly once, never return free text.',
  input_schema: {
    type: 'object',
    required: ['niche', 'tone', 'audience', 'recommendedSlideCount', 'slides'],
    properties: {
      niche: {
        type: 'string',
        description: 'Specific niche, 2 to 6 words.',
      },
      subNiche: {
        type: 'string',
        description: 'Optional further refinement of the niche.',
      },
      tone: {
        type: 'string',
        description:
          'Descriptive voice/tone, e.g. "authoritative teaching", "playful storytelling".',
      },
      audience: {
        type: 'string',
        description: 'Who this carousel is for.',
      },
      recommendedSlideCount: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Total number of slides in the breakdown.',
      },
      slides: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          required: ['purpose', 'headline'],
          properties: {
            purpose: {
              type: 'string',
              description:
                'Prefer one of: hook, point, data, quote, comparison, step, cta. May be a custom snake_case string when none fits.',
            },
            headline: {
              type: 'string',
              description: 'Slide headline. 3 to 10 words ideal, max 15.',
            },
            body: {
              type: 'string',
              description: 'Optional supporting text. Under 50 words. Omit when not needed.',
            },
            emphasis: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Exact substrings from the headline to visually highlight. Often empty.',
            },
          },
        },
      },
    },
  },
}

/**
 * Build the user message that gets sent alongside the system prompt.
 * Kept here so the prompt module is the single source of truth for
 * everything Claude sees on this task.
 */
export function buildAnalyzeScriptUserMessage(input: {
  script: string
  referenceSlideCount?: number
  platform?: { platform: string; format: string }
}): string {
  const lines: string[] = []

  if (input.platform) {
    lines.push(
      `Platform: ${input.platform.platform} (${input.platform.format} format).`,
    )
  }

  if (typeof input.referenceSlideCount === 'number') {
    lines.push(
      `The creator's reference carousels have ~${input.referenceSlideCount} slides. Target that count within ±2.`,
    )
  }

  lines.push('', 'Script:', '---', input.script.trim(), '---')

  return lines.join('\n')
}
