/**
 * Claude provider — Anthropic SDK adapter.
 *
 * Implements: analyzeScript, analyzeReference, identifyFont, chat.
 * Skips: embed (use OpenAI), generateImage (use Replicate).
 *
 * Method bodies are stubs intentionally — we'll wire each one in when
 * we build the corresponding feature in app/. This file's job right
 * now is to lock the shape and the constructor signature.
 */

import Anthropic from '@anthropic-ai/sdk'
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

/** Update when Anthropic releases a newer Claude model id. */
const DEFAULT_MODEL = 'claude-opus-4-7'

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
    _req: AnalyzeScriptRequest,
    _signal?: AbortSignal,
  ): Promise<AnalyzeScriptResult> {
    // TODO: messages.create with a tool that returns the ScriptAnalysis JSON.
    throw new Error('ClaudeProvider.analyzeScript not implemented')
  }

  async analyzeReference(
    _req: AnalyzeReferenceRequest,
    _signal?: AbortSignal,
  ): Promise<AnalyzeReferenceResult> {
    // TODO: messages.create with image content blocks + a structured-output tool.
    throw new Error('ClaudeProvider.analyzeReference not implemented')
  }

  async identifyFont(
    _req: IdentifyFontRequest,
    _signal?: AbortSignal,
  ): Promise<IdentifyFontResult> {
    // TODO: vision call returning ranked font candidates.
    throw new Error('ClaudeProvider.identifyFont not implemented')
  }

  async *chat(
    _req: ChatRequest,
    _signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    // TODO: messages.stream with tool use, mapped to ChatStreamChunk events.
    throw new Error('ClaudeProvider.chat not implemented')
    // biome-ignore lint/correctness/useYield: stub
  }
}
