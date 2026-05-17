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
        max_tokens: 4096,
        system: ANALYZE_SCRIPT_SYSTEM_PROMPT,
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

    // Find the tool_use content block. With tool_choice forcing the tool,
    // there should be exactly one.
    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> =>
        block.type === 'tool_use',
    )

    if (!toolUse) {
      throw new Error(
        'ClaudeProvider.analyzeScript: model did not return a tool_use block',
      )
    }

    // Validate against our Zod schema. If Claude's output drifts from the
    // schema (rare, but possible), Zod tells us exactly what's wrong.
    const parsed = ScriptAnalysisSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      throw new Error(
        `ClaudeProvider.analyzeScript: tool output failed validation: ${parsed.error.message}`,
      )
    }

    const durationMs = Date.now() - start
    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const cachedInputTokens = response.usage.cache_read_input_tokens ?? 0

    return {
      data: parsed.data,
      usage: {
        provider: 'claude',
        model: this.model,
        durationMs,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        estimatedCostUsd: estimateClaudeCost(
          this.model,
          inputTokens,
          outputTokens,
          cachedInputTokens,
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
