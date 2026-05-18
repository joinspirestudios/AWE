/**
 * Gemini provider — Google AI SDK adapter.
 *
 * Implements: analyzeReference.
 * Stubbed (not yet implemented): analyzeScript (fallback role), identifyFont, chat.
 * Skips by design: embed, generateImage.
 */

import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai'
import { StyleSpecSchema } from '@app/scene'

import {
  ANALYZE_REFERENCE_SYSTEM_PROMPT,
  ANALYZE_REFERENCE_TOOL,
  ANALYZE_REFERENCE_VERSION,
  buildAnalyzeReferenceUserMessage,
} from '../prompts/analyze-reference'
import { estimateGeminiCost } from '../pricing'
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

/** Default model. 2.5 Pro is strongest at structured visual reasoning. */
const DEFAULT_MODEL = 'gemini-2.5-pro'

/**
 * Max images we'll inline-encode in one request. Gemini supports many more,
 * but each adds latency and tokens. Beyond this we'd want a chunked
 * strategy or a different approach.
 */
const MAX_IMAGES_PER_REQUEST = 24

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

  async analyzeReference(
    req: AnalyzeReferenceRequest,
    signal?: AbortSignal,
  ): Promise<AnalyzeReferenceResult> {
    if (req.images.length === 0) {
      throw new Error('GeminiProvider.analyzeReference: no images provided')
    }
    if (req.images.length > MAX_IMAGES_PER_REQUEST) {
      throw new Error(
        `GeminiProvider.analyzeReference: too many images (${req.images.length} > ${MAX_IMAGES_PER_REQUEST}). Reduce or chunk the references.`,
      )
    }

    const start = Date.now()

    // Download all images in parallel, base64-encode each. Server-to-server
    // fetch from our Supabase bucket is fast and authless.
    const imageParts = await Promise.all(
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
          inlineData: {
            mimeType: normalizeMimeType(contentType),
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

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [{ text: userText }, ...imageParts],
        },
      ],
      config: {
        systemInstruction: ANALYZE_REFERENCE_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: [ANALYZE_REFERENCE_TOOL] }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [ANALYZE_REFERENCE_TOOL.name ?? ''],
          },
        },
        // NOTE: do not pass `labels` here — that's a Vertex AI field and
        // the Gemini Developer API rejects it at request time. We tag the
        // prompt version in the system prompt itself instead.
      },
    })

    // Extract function call from response. With function-calling forced,
    // there should be exactly one.
    const functionCalls = response.functionCalls ?? []
    const call = functionCalls[0]
    if (!call || !call.args) {
      throw new Error(
        'GeminiProvider.analyzeReference: model did not return a function call',
      )
    }

    const parsed = StyleSpecSchema.safeParse(call.args)
    if (!parsed.success) {
      console.error('[analyzeReference] validation failed', {
        rawArgs: JSON.stringify(call.args),
        zodIssues: parsed.error.issues,
      })
      throw new Error(
        `GeminiProvider.analyzeReference: function output failed validation. ${parsed.error.issues.length} issue(s): ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      )
    }

    const durationMs = Date.now() - start
    const usage = response.usageMetadata
    const inputTokens = usage?.promptTokenCount ?? 0
    const outputTokens = usage?.candidatesTokenCount ?? 0

    return {
      data: parsed.data,
      usage: {
        provider: 'gemini',
        model: this.model,
        durationMs,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateGeminiCost(this.model, inputTokens, outputTokens),
      },
    }
  }

  async analyzeScript(
    _req: AnalyzeScriptRequest,
    _signal?: AbortSignal,
  ): Promise<AnalyzeScriptResult> {
    throw new Error('GeminiProvider.analyzeScript not implemented (fallback role)')
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

/** Normalize Content-Type strings to the MIME types Gemini accepts. */
function normalizeMimeType(contentType: string): string {
  const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
  if (ct === 'image/jpg') return 'image/jpeg'
  if (ct.startsWith('image/')) return ct
  return 'image/jpeg'
}
