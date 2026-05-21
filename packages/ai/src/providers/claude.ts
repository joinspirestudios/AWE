/**
 * Claude provider — Anthropic SDK adapter.
 *
 * Implements: analyzeScript, analyzeReference (vision), analyzeLayouts (vision).
 * Stubbed (not implemented yet): identifyFont, chat.
 * Skips by design: embed (use OpenAI), generateImage (use Replicate).
 */

import Anthropic from '@anthropic-ai/sdk'
import { LayoutSpecSchema, ScriptAnalysisSchema, StyleSpecSchema } from '@app/scene'

import {
  ANALYZE_LAYOUTS_INPUT_SCHEMA,
  ANALYZE_LAYOUTS_SYSTEM_PROMPT,
  ANALYZE_LAYOUTS_TOOL,
  ANALYZE_LAYOUTS_VERSION,
  buildAnalyzeLayoutsUserMessage,
} from '../prompts/analyze-layouts'
import {
  ANALYZE_REFERENCE_INPUT_SCHEMA,
  ANALYZE_REFERENCE_SYSTEM_PROMPT,
  ANALYZE_REFERENCE_TOOL,
  ANALYZE_REFERENCE_VERSION,
  buildAnalyzeReferenceUserMessage,
} from '../prompts/analyze-reference'
import {
  ANALYZE_SCRIPT_SYSTEM_PROMPT,
  ANALYZE_SCRIPT_TOOL,
  ANALYZE_SCRIPT_VERSION,
  buildAnalyzeScriptUserMessage,
} from '../prompts/analyze-script'
import { estimateClaudeCost } from '../pricing'
import {
  buildSynthesizeCarouselPlanUserMessage,
  isCarouselPlanLike,
  SYNTHESIZE_CAROUSEL_PLAN_INPUT_SCHEMA,
  SYNTHESIZE_CAROUSEL_PLAN_SYSTEM_PROMPT,
} from '../prompts/synthesize-carousel-plan'
import type {
  AIProvider,
  AnalyzeLayoutsRequest,
  AnalyzeLayoutsResult,
  AnalyzeReferenceRequest,
  AnalyzeReferenceResult,
  AnalyzeScriptRequest,
  AnalyzeScriptResult,
  ChatRequest,
  ChatStreamChunk,
  IdentifyFontRequest,
  IdentifyFontResult,
  ProviderName,
  SynthesizeCarouselPlanRequest,
  SynthesizeCarouselPlanResult,
} from '../types'

/** Default model. Sonnet is the right balance of cost and quality for reasoning tasks. */
const DEFAULT_MODEL = 'claude-sonnet-4-6'

type TaskModelOverrides = Partial<{
  analyzeScript: string
  analyzeReference: string
  analyzeLayouts: string
  identifyFont: string
  chat: string
}>

export interface ClaudeProviderOptions {
  apiKey: string
  /** Default model for tasks without a specific override. */
  defaultModel?: string
  /**
   * Per-task model overrides. The mechanism exists for future routing
   * needs (e.g. sending lighter sub-tasks to Haiku), but we deliberately
   * leave it empty by default — the fallback path uses the full-quality
   * model so it never sacrifices output quality just to fit under a
   * timeout. The timeout is sized for Sonnet in the router instead.
   */
  taskModels?: TaskModelOverrides
}

export class ClaudeProvider implements AIProvider {
  readonly name: ProviderName = 'claude'
  private client: Anthropic
  private defaultModel: string
  private taskModels: TaskModelOverrides

  constructor(opts: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey })
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL
    this.taskModels = opts.taskModels ?? {}
  }

  /** Resolve which model to use for a given task. */
  private modelFor(task: keyof TaskModelOverrides): string {
    return this.taskModels[task] ?? this.defaultModel
  }

  async analyzeScript(
    req: AnalyzeScriptRequest,
    signal?: AbortSignal,
  ): Promise<AnalyzeScriptResult> {
    const start = Date.now()

    const userMessage = buildAnalyzeScriptUserMessage({
      script: req.script,
      referenceSlideCount: req.referenceSlideCount,
      platform: req.platform
        ? { platform: req.platform.platform, format: req.platform.format }
        : undefined,
    })

    const response = await this.client.messages.create(
      {
        model: this.modelFor('analyzeScript'),
        // 16K covers even 20-slide carousels with detailed bodies. Sonnet
        // 4.6 supports up to 64K output tokens; we cap here to prevent
        // pathologically long responses without truncating real ones.
        max_tokens: 16_384,
        // System prompt is identical across every analyzeScript call, so
        // we mark it for ephemeral caching (5-minute TTL). First call
        // within the window writes the cache (~25% premium on those
        // input tokens); subsequent calls read at 90% off normal input
        // rate. Net win for any active session.
        system: [
          {
            type: 'text',
            text: ANALYZE_SCRIPT_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
        tools: [ANALYZE_SCRIPT_TOOL],
        // Force Claude to call our tool — no free-text replies possible.
        tool_choice: { type: 'tool', name: ANALYZE_SCRIPT_TOOL.name },
        metadata: {
          // Tagged so we can filter Anthropic Console logs by prompt version.
          user_id: `analyze-script-${ANALYZE_SCRIPT_VERSION}`,
        },
      },
      { signal },
    )

    // If the response got truncated mid-tool-call, surface a clean error
    // instead of letting Zod fail on partial JSON downstream.
    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        'ClaudeProvider.analyzeScript: response was truncated (hit max_tokens). The script may be unusually long or dense — try splitting it.',
      )
    }

    // Find the tool_use content block. With tool_choice forcing the tool,
    // there should be exactly one.
    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> =>
        block.type === 'tool_use',
    )

    if (!toolUse) {
      throw new Error(
        `ClaudeProvider.analyzeScript: model did not return a tool_use block (stop_reason=${response.stop_reason})`,
      )
    }

    // Defensive normalization: Claude sometimes returns array fields as
    // JSON-encoded strings when their content contains many escaped quotes
    // (e.g. headlines like `"boring life"`). We try to recover by parsing
    // such strings before validating. If the parse fails, Zod handles the
    // error downstream.
    const rawInput = toolUse.input as Record<string, unknown>
    const normalizedInput: Record<string, unknown> = { ...rawInput }
    for (const key of ['slides'] as const) {
      const value = normalizedInput[key]
      if (typeof value === 'string') {
        try {
          const reparsed = JSON.parse(value)
          if (Array.isArray(reparsed)) {
            normalizedInput[key] = reparsed
          }
        } catch {
          // leave as-is; Zod will produce a clear error
        }
      }
    }

    // Validate against our Zod schema. If Claude's output drifts from the
    // schema (rare, but possible), log the raw input + Zod issues so we
    // can diagnose without redeploying, then throw.
    const parsed = ScriptAnalysisSchema.safeParse(normalizedInput)
    if (!parsed.success) {
      console.error('[analyzeScript] validation failed', {
        rawToolInput: JSON.stringify(toolUse.input),
        normalizedKeys: Object.keys(normalizedInput),
        zodIssues: parsed.error.issues,
        stopReason: response.stop_reason,
      })
      throw new Error(
        `ClaudeProvider.analyzeScript: tool output failed validation. ${parsed.error.issues.length} issue(s): ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      )
    }

    const durationMs = Date.now() - start
    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0
    const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0

    return {
      data: parsed.data,
      usage: {
        provider: 'claude',
        model: this.modelFor('analyzeScript'),
        durationMs,
        inputTokens,
        outputTokens,
        cachedInputTokens: cacheReadTokens,
        estimatedCostUsd: estimateClaudeCost(
          this.modelFor('analyzeScript'),
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
        ),
      },
    }
  }

  async analyzeReference(
    req: AnalyzeReferenceRequest,
    signal?: AbortSignal,
  ): Promise<AnalyzeReferenceResult> {
    if (req.images.length === 0) {
      throw new Error('ClaudeProvider.analyzeReference: no images provided')
    }
    // Claude vision supports up to 100 images per API request. 50 matches
    // our route-level cap and keeps a single call's latency reasonable.
    if (req.images.length > 50) {
      throw new Error(
        `ClaudeProvider.analyzeReference: too many images (${req.images.length} > 50). Reduce or chunk the references.`,
      )
    }

    const start = Date.now()

    // Download all images server-side, base64-encode each. Claude wants
    // image content as { type: 'image', source: { type: 'base64', ... } }.
    const imageBlocks = await Promise.all(
      req.images.map(async (img) => {
        const res = await fetch(img.src, { signal })
        if (!res.ok) {
          throw new Error(
            `Failed to download reference image (${res.status}): ${img.src.slice(0, 80)}`,
          )
        }
        const contentType = res.headers.get('content-type') ?? 'image/jpeg'
        const arrayBuffer = await res.arrayBuffer()
        const base64 = Buffer.from(arrayBuffer).toString('base64')
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            // Claude's supported MIME types: jpeg, png, gif, webp.
            media_type: normalizeAnthropicMediaType(contentType),
            data: base64,
          },
        }
      }),
    )

    const userText = buildAnalyzeReferenceUserMessage({
      imageCount: req.images.length,
      platform: req.platform
        ? { platform: req.platform.platform, format: req.platform.format }
        : undefined,
    })

    // Use the canonical schema (pristine lowercase 'object' types) — do
    // NOT read from ANALYZE_REFERENCE_TOOL.parameters because the Gemini
    // SDK normalizes that object in place when it serializes tools, which
    // would leak uppercase 'OBJECT' into Anthropic's request and trigger
    // a 400.
    const claudeReferenceTool: Anthropic.Tool = {
      name: ANALYZE_REFERENCE_TOOL.name ?? 'submit_style_spec',
      description: ANALYZE_REFERENCE_TOOL.description ?? '',
      input_schema: ANALYZE_REFERENCE_INPUT_SCHEMA,
    }

    const response = await this.client.messages.create(
      {
        model: this.modelFor('analyzeReference'),
        max_tokens: 4_096,
        system: [
          {
            type: 'text',
            text: ANALYZE_REFERENCE_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }, ...imageBlocks],
          },
        ],
        tools: [claudeReferenceTool],
        tool_choice: { type: 'tool', name: claudeReferenceTool.name },
        metadata: {
          user_id: `analyze-reference-${ANALYZE_REFERENCE_VERSION}`,
        },
      },
      { signal },
    )

    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        'ClaudeProvider.analyzeReference: response was truncated (hit max_tokens).',
      )
    }

    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> =>
        block.type === 'tool_use',
    )
    if (!toolUse) {
      throw new Error(
        `ClaudeProvider.analyzeReference: model did not return a tool_use block (stop_reason=${response.stop_reason})`,
      )
    }

    const parsed = StyleSpecSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      console.error('[analyzeReference:claude] validation failed', {
        rawToolInput: JSON.stringify(toolUse.input),
        zodIssues: parsed.error.issues,
        stopReason: response.stop_reason,
      })
      throw new Error(
        `ClaudeProvider.analyzeReference: tool output failed validation. ${parsed.error.issues.length} issue(s): ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      )
    }

    const durationMs = Date.now() - start
    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0
    const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0

    return {
      data: parsed.data,
      usage: {
        provider: 'claude',
        model: this.modelFor('analyzeReference'),
        durationMs,
        inputTokens,
        outputTokens,
        cachedInputTokens: cacheReadTokens,
        estimatedCostUsd: estimateClaudeCost(
          this.modelFor('analyzeReference'),
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
        ),
      },
    }
  }

  async analyzeLayouts(
    req: AnalyzeLayoutsRequest,
    signal?: AbortSignal,
  ): Promise<AnalyzeLayoutsResult> {
    if (req.images.length === 0) {
      throw new Error('ClaudeProvider.analyzeLayouts: no images provided')
    }
    if (req.images.length > 50) {
      throw new Error(
        `ClaudeProvider.analyzeLayouts: too many images (${req.images.length} > 50). Reduce or chunk the references.`,
      )
    }

    const start = Date.now()

    const imageBlocks = await Promise.all(
      req.images.map(async (img) => {
        const res = await fetch(img.src, { signal })
        if (!res.ok) {
          throw new Error(
            `Failed to download reference image (${res.status}): ${img.src.slice(0, 80)}`,
          )
        }
        const contentType = res.headers.get('content-type') ?? 'image/jpeg'
        const arrayBuffer = await res.arrayBuffer()
        const base64 = Buffer.from(arrayBuffer).toString('base64')
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: normalizeAnthropicMediaType(contentType),
            data: base64,
          },
        }
      }),
    )

    const userText = buildAnalyzeLayoutsUserMessage({
      imageCount: req.images.length,
      platform: req.platform
        ? { platform: req.platform.platform, format: req.platform.format }
        : undefined,
      imageOrder: req.images.map((img) => ({
        order: img.order,
        postId: img.postId,
      })),
    })

    // Use the canonical schema (pristine lowercase 'object' types) — NOT
    // ANALYZE_LAYOUTS_TOOL.parameters, which the Gemini SDK mutates in
    // place. See the matching comment in analyzeReference above.
    const claudeLayoutsTool: Anthropic.Tool = {
      name: ANALYZE_LAYOUTS_TOOL.name ?? 'submit_layout_spec',
      description: ANALYZE_LAYOUTS_TOOL.description ?? '',
      input_schema: ANALYZE_LAYOUTS_INPUT_SCHEMA,
    }

    // LayoutSpec output scales with slide count. Each SlideLayout is
    // ~150-300 tokens; with 50 slides plus patterns and notes, we can
    // easily need 12-15k output tokens. 16384 leaves comfortable headroom.
    const response = await this.client.messages.create(
      {
        model: this.modelFor('analyzeLayouts'),
        max_tokens: 16_384,
        system: [
          {
            type: 'text',
            text: ANALYZE_LAYOUTS_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }, ...imageBlocks],
          },
        ],
        tools: [claudeLayoutsTool],
        tool_choice: { type: 'tool', name: claudeLayoutsTool.name },
        metadata: {
          user_id: `analyze-layouts-${ANALYZE_LAYOUTS_VERSION}`,
        },
      },
      { signal },
    )

    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        'ClaudeProvider.analyzeLayouts: response was truncated (hit max_tokens). The reference set is too large for a single pass — consider chunking.',
      )
    }

    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> =>
        block.type === 'tool_use',
    )
    if (!toolUse) {
      throw new Error(
        `ClaudeProvider.analyzeLayouts: model did not return a tool_use block (stop_reason=${response.stop_reason})`,
      )
    }

    const parsed = LayoutSpecSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      console.error('[analyzeLayouts:claude] validation failed', {
        rawToolInput: JSON.stringify(toolUse.input),
        zodIssues: parsed.error.issues,
        stopReason: response.stop_reason,
      })
      throw new Error(
        `ClaudeProvider.analyzeLayouts: tool output failed validation. ${parsed.error.issues.length} issue(s): ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      )
    }

    const durationMs = Date.now() - start
    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0
    const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0

    return {
      data: parsed.data,
      usage: {
        provider: 'claude',
        model: this.modelFor('analyzeLayouts'),
        durationMs,
        inputTokens,
        outputTokens,
        cachedInputTokens: cacheReadTokens,
        estimatedCostUsd: estimateClaudeCost(
          this.modelFor('analyzeLayouts'),
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
        ),
      },
    }
  }

  async synthesizeCarouselPlan(
    req: SynthesizeCarouselPlanRequest,
    signal?: AbortSignal,
  ): Promise<SynthesizeCarouselPlanResult> {
    const start = Date.now()

    const userMessage = buildSynthesizeCarouselPlanUserMessage({
      script: req.script,
      references: req.references,
      platform: req.platform
        ? { platform: req.platform.platform, format: req.platform.format }
        : undefined,
    })

    // Build Claude's tool from the canonical JSON Schema. The schema is
    // already in JSON Schema format — Claude accepts that directly. We
    // do NOT structuredClone here: only Gemini needs that protection
    // (its SDK mutates parameters in place).
    const tool = {
      name: 'submit_carousel_plan',
      description:
        'Return the synthesized per-slide design plan for the creator\'s carousel.',
      input_schema:
        SYNTHESIZE_CAROUSEL_PLAN_INPUT_SCHEMA as unknown as Record<
          string,
          unknown
        > & {
          type: 'object'
        },
    }

    const response = await this.client.messages.create(
      {
        model: this.modelFor('analyzeScript'),
        // The plan can be verbose if the script is 15+ slides with full
        // rationale + drawsFrom on each. 8K covers the realistic upper
        // bound; 16K is overkill but matches our other reasoning tasks.
        max_tokens: 8_192,
        // System prompt is identical per call — cache it ephemerally so
        // repeated synthesis runs in a session benefit.
        system: [
          {
            type: 'text',
            text: SYNTHESIZE_CAROUSEL_PLAN_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        metadata: {
          user_id: 'synthesize-carousel-plan-v1.0.0',
        },
      },
      { signal },
    )

    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        'ClaudeProvider.synthesizeCarouselPlan: response truncated (hit max_tokens). The script + references may be unusually dense.',
      )
    }

    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> =>
        block.type === 'tool_use',
    )

    if (!toolUse) {
      throw new Error(
        `ClaudeProvider.synthesizeCarouselPlan: model did not return a tool_use block (stop_reason=${response.stop_reason})`,
      )
    }

    const rawInput = toolUse.input as Record<string, unknown>

    // Defensive: same string-encoded-array pattern as analyzeScript.
    // Claude occasionally returns `slides` as a JSON string when it
    // contains lots of escaped content.
    const normalizedInput: Record<string, unknown> = { ...rawInput }
    if (typeof normalizedInput.slides === 'string') {
      try {
        normalizedInput.slides = JSON.parse(normalizedInput.slides as string)
      } catch {
        // Fall through; downstream Zod validation will surface the issue.
      }
    }

    if (!isCarouselPlanLike(normalizedInput)) {
      throw new Error(
        'ClaudeProvider.synthesizeCarouselPlan: tool input did not contain a non-empty slides array.',
      )
    }

    const durationMs = Date.now() - start
    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0
    const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0

    return {
      data: normalizedInput,
      usage: {
        provider: 'claude',
        model: this.modelFor('analyzeScript'),
        durationMs,
        inputTokens,
        outputTokens,
        cachedInputTokens: cacheReadTokens,
        estimatedCostUsd: estimateClaudeCost(
          this.modelFor('analyzeScript'),
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
        ),
      },
    }
  }

  async identifyFont(
    _req: IdentifyFontRequest,
    _signal?: AbortSignal,
  ): Promise<IdentifyFontResult> {
    throw new Error('ClaudeProvider.identifyFont not implemented')
  }

  async *chat(
    _req: ChatRequest,
    _signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    throw new Error('ClaudeProvider.chat not implemented')
    // biome-ignore lint/correctness/useYield: stub
  }
}

/**
 * Normalize a Content-Type to the four image MIME types Claude vision
 * accepts: image/jpeg, image/png, image/gif, image/webp. Anything else
 * falls back to jpeg (Supabase serves jpegs by default for our scraped
 * Instagram references, so this is rarely hit).
 */
function normalizeAnthropicMediaType(
  contentType: string,
): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
  if (ct === 'image/png') return 'image/png'
  if (ct === 'image/gif') return 'image/gif'
  if (ct === 'image/webp') return 'image/webp'
  // image/jpg, image/jpeg, or anything unknown → jpeg.
  return 'image/jpeg'
}
