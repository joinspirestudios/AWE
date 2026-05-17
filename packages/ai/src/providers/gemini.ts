/**
 * Gemini provider — Google GenAI SDK adapter.
 *
 * Primary for vision-heavy tasks (analyzeReference, identifyFont).
 * Fallback for analyzeScript and chat.
 */

import { GoogleGenAI } from '@google/genai'
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

/** Update when Google releases a newer Gemini model id. */
const DEFAULT_MODEL = 'gemini-2.5-pro'

export interface GeminiProviderOptions {
  apiKey: string
  defaultModel?: string
}

export class GeminiProvider implements AIProvider {
  readonly name: ProviderName = 'gemini'
  private client: GoogleGenAI
  private model: string

  constructor(opts: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: opts.apiKey })
    this.model = opts.defaultModel ?? DEFAULT_MODEL
  }

  async analyzeScript(
    _req: AnalyzeScriptRequest,
    _signal?: AbortSignal,
  ): Promise<AnalyzeScriptResult> {
    throw new Error('GeminiProvider.analyzeScript not implemented')
  }

  async analyzeReference(
    _req: AnalyzeReferenceRequest,
    _signal?: AbortSignal,
  ): Promise<AnalyzeReferenceResult> {
    // TODO: generateContent with images + structured JSON output (responseSchema).
    throw new Error('GeminiProvider.analyzeReference not implemented')
  }

  async identifyFont(
    _req: IdentifyFontRequest,
    _signal?: AbortSignal,
  ): Promise<IdentifyFontResult> {
    throw new Error('GeminiProvider.identifyFont not implemented')
  }

  async *chat(
    _req: ChatRequest,
    _signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    throw new Error('GeminiProvider.chat not implemented')
    // biome-ignore lint/correctness/useYield: stub
  }
}
