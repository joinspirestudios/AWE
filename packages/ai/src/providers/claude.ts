/**
 * Claude provider — Anthropic SDK adapter.
 *
 * Implements: analyzeScript.
 * Stubbed (not implemented yet): analyzeReference, identifyFont, chat.
 * Skips by design: embed (use OpenAI), generateImage (use Replicate).
 */

import Anthropic from '@anthropic-ai/sdk'
import { ScriptAnalysisSchema } from '@app/scene'

import {
  ANALYZE_SCRIPT_SYSTEM_PROMPT,
  ANALYZE_SCRIPT_TOOL,
  ANALYZE_SCRIPT_VERSION,
  buildAnalyzeScriptUserMessage,
} from '../prompts/analyze-script'
import { estimateClaudeCost } from '../pricing'
import type {
  AIProvider,
  AnalyzeReferenceRequest,
  AnalyzeReferenceResult,
  AnalyzeScriptRequest,
  AnalyzeScriptResult,
  ChatRequest,
  ChatStreamChunk,
  IdentifyFontRequest,
  IdentifyFontResult,
  ProviderName,
} from '../types'

/** Default model. Sonnet is the right balance of cost and quality for analysis tasks. */
const DEFAULT_MODEL = 'claude-sonnet-4-6'

export interface ClaudeProviderOptions {
  apiKey: string
  /** Override the model for all tasks. */
  defaultModel?: string
}

export class ClaudeProvider implements AIProvider {
  readonly name: ProviderName = 'claude'
  private client: Anthropic
  private model: string

  constructor(opts: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey })
    this.model = opts.defaultModel ?? DEFAULT_MODEL
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
        model: this.model,
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
        model: this.model,
        durationMs,
        inputTokens,
        outputTokens,
        cachedInputTokens: cacheReadTokens,
        estimatedCostUsd: estimateClaudeCost(
          this.model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
        ),
      },
    }
  }

  async analyzeReference(
    _req: AnalyzeReferenceRequest,
    _signal?: AbortSignal,
  ): Promise<AnalyzeReferenceResult> {
    throw new Error('ClaudeProvider.analyzeReference not implemented')
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
