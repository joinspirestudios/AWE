/**
 * Gemini provider — Google AI SDK adapter.
 *
 * Implements: analyzeReference.
 * Stubbed (not yet implemented): analyzeScript (fallback role), identifyFont, chat.
 * Skips by design: embed, generateImage.
 */

import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai'
import { LayoutSpecSchema, StyleSpecSchema } from '@app/scene'

import {
  ANALYZE_LAYOUTS_SYSTEM_PROMPT,
  ANALYZE_LAYOUTS_TOOL,
  buildAnalyzeLayoutsUserMessage,
} from '../prompts/analyze-layouts'
import {
  ANALYZE_REFERENCE_SYSTEM_PROMPT,
  ANALYZE_REFERENCE_TOOL,
  buildAnalyzeReferenceUserMessage,
} from '../prompts/analyze-reference'
import { estimateGeminiCost } from '../pricing'
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
} from '../types'

/**
 * Default model. Flash is in the free tier and is plenty capable for
 * structured visual extraction (color sampling, font category ID, layout
 * description). Pro was removed from the free tier on April 1, 2026 and
 * is only worth paying for if we need its deeper reasoning — not
 * something this task needs. Override via `defaultModel` in the
 * constructor when we move to paid tier.
 */
const DEFAULT_MODEL = 'gemini-2.5-flash'

/**
 * Max images we'll inline-encode in one request. Gemini supports many more
 * (the SDK accepts thousands), but each adds latency and tokens. 50 covers
 * realistic multi-reference workflows — say, three carousels at 10-20
 * slides each — without becoming a single slow, expensive call. Beyond
 * this we'd want a chunked strategy.
 */
const MAX_IMAGES_PER_REQUEST = 50

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

  async analyzeLayouts(
    req: AnalyzeLayoutsRequest,
    signal?: AbortSignal,
  ): Promise<AnalyzeLayoutsResult> {
    if (req.images.length === 0) {
      throw new Error('GeminiProvider.analyzeLayouts: no images provided')
    }
    if (req.images.length > MAX_IMAGES_PER_REQUEST) {
      throw new Error(
        `GeminiProvider.analyzeLayouts: too many images (${req.images.length} > ${MAX_IMAGES_PER_REQUEST}). Reduce or chunk the references.`,
      )
    }

    const start = Date.now()

    // Same image-encoding strategy as analyzeReference. The two calls run
    // in parallel from the API route, so the duplicated download cost is
    // wall-clock-free (just doubled bandwidth into the function).
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

    const userText = buildAnalyzeLayoutsUserMessage({
      imageCount: req.images.length,
      platform: req.platform
        ? { platform: req.platform.platform, format: req.platform.format }
        : undefined,
      // Pass the order + postId mapping so the model uses our indices
      // verbatim instead of inventing its own.
      imageOrder: req.images.map((img) => ({
        order: img.order,
        postId: img.postId,
      })),
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
        systemInstruction: ANALYZE_LAYOUTS_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: [ANALYZE_LAYOUTS_TOOL] }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [ANALYZE_LAYOUTS_TOOL.name ?? ''],
          },
        },
      },
    })

    const functionCalls = response.functionCalls ?? []
    const call = functionCalls[0]
    if (!call || !call.args) {
      throw new Error(
        'GeminiProvider.analyzeLayouts: model did not return a function call',
      )
    }

    const parsed = LayoutSpecSchema.safeParse(call.args)
    if (!parsed.success) {
      console.error('[analyzeLayouts] validation failed', {
        rawArgs: JSON.stringify(call.args),
        zodIssues: parsed.error.issues,
      })
      throw new Error(
        `GeminiProvider.analyzeLayouts: function output failed validation. ${parsed.error.issues.length} issue(s): ${parsed.error.issues
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
