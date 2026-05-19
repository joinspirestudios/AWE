/**
 * AI Provider Interface
 *
 * This file is the architectural piece that keeps Create from being a
 * single-model wrapper. Every AI capability the app needs is defined here
 * as a typed task. Each concrete provider (Claude, Gemini, OpenAI,
 * Replicate) implements only the tasks it's good at. The router (./router)
 * picks the right provider per task and falls back through alternatives
 * on failure.
 *
 * Adding a new provider:
 *   1. Implement AIProvider with the methods you support.
 *   2. Register it with the router at app boot.
 *
 * Adding a new task:
 *   1. Add request/result interfaces here.
 *   2. Add the method (optional) to AIProvider.
 *   3. Add it to TaskName, TaskRequest, TaskResult.
 *   4. Add a default route in router.ts.
 *   5. Implement it on at least one provider.
 */

import type {
  FontGuess,
  LayoutSpec,
  PlatformFormat,
  ScriptAnalysis,
  StyleSpec,
} from '@app/scene'

// =========================================================================
// PROVIDER METADATA
// =========================================================================

export type ProviderName = 'claude' | 'gemini' | 'openai' | 'replicate'

/** Per-call usage telemetry. Wire to PostHog for cost + latency tracking. */
export interface ProviderUsage {
  provider: ProviderName
  model: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  /** Estimated cost in USD, computed from token counts and per-provider pricing. */
  estimatedCostUsd?: number
}

/** Wraps any non-streaming task result with usage info. */
export interface ProviderResult<T> {
  data: T
  usage: ProviderUsage
}

// =========================================================================
// TASK: analyzeScript
//
// Script in, ScriptAnalysis out. Drives the slide breakdown that the
// generator uses to lay out the carousel.
//
// Primary: Claude. Fallback: Gemini.
// =========================================================================

export interface AnalyzeScriptRequest {
  script: string
  platform?: PlatformFormat
  /**
   * When references are supplied, the AI should mirror their slide count.
   * Otherwise it infers from script density.
   */
  referenceSlideCount?: number
}

export type AnalyzeScriptResult = ProviderResult<ScriptAnalysis>

// =========================================================================
// TASK: analyzeReference
//
// Reference image(s) in, StyleSpec out. The vision pass that extracts
// colors, typography, layout, background treatment, and font guesses.
//
// Primary: Gemini (stronger at structured visual reasoning). Fallback: Claude.
// =========================================================================

export interface AnalyzeReferenceRequest {
  /**
   * Ordered images. `order` is per-post (so slide 1 of post A and slide 1
   * of post B both have order 0). `postId` lets the model treat pages
   * from the same source as a unit when reasoning about slide patterns.
   */
  images: Array<{ src: string; order: number; postId?: string }>
  platform?: PlatformFormat
}

export type AnalyzeReferenceResult = ProviderResult<StyleSpec>

// =========================================================================
// TASK: analyzeLayouts
//
// Reference image(s) in, LayoutSpec out. Per-slide layout templates plus
// observed cross-slide patterns. The generator consumes this alongside
// StyleSpec: StyleSpec tells it how things should look; LayoutSpec tells
// it how things should be arranged.
//
// Primary: Gemini (vision). Fallback: Claude.
// =========================================================================

export interface AnalyzeLayoutsRequest {
  /** Same shape as AnalyzeReferenceRequest — these calls share inputs. */
  images: Array<{ src: string; order: number; postId?: string }>
  platform?: PlatformFormat
}

export type AnalyzeLayoutsResult = ProviderResult<LayoutSpec>

// =========================================================================
// TASK: identifyFont
//
// Crop of text in, ranked FontGuess[] out. Up to 3 candidates, top match
// first. Empty array means the model couldn't identify a specific family.
//
// Primary: Gemini. Fallback: Claude.
// =========================================================================

export interface IdentifyFontRequest {
  imageSrc: string
  role: 'headline' | 'body' | 'unknown'
}

export type IdentifyFontResult = ProviderResult<FontGuess[]>

// =========================================================================
// TASK: embed
//
// Text in, vector(s) out. For RAG over the trending library, similarity
// search across user designs, and the learning loop's pattern clustering.
//
// Primary: OpenAI (text-embedding-3-small). No fallback in V1 — switching
// embedding models invalidates the vector index, so this is a one-provider
// task by design.
// =========================================================================

export interface EmbedRequest {
  /** Single string or batch. Batch is more efficient for indexing. */
  input: string | string[]
}

export interface EmbedResultData {
  embeddings: number[][]
  dimensions: number
}

export type EmbedResult = ProviderResult<EmbedResultData>

// =========================================================================
// TASK: chat (streaming, with tool use)
//
// The in-editor Magic panel. Streams text and tool calls so the editor
// can apply each tool call as it arrives — no waiting for the whole
// response.
//
// Primary: Claude. Fallback: Gemini.
// =========================================================================

export interface ChatTool {
  name: string
  description: string
  /** JSON Schema for arguments. Providers convert to their native format. */
  inputSchema: Record<string, unknown>
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: ChatContent[]
}

export type ChatContent =
  | { type: 'text'; text: string }
  | { type: 'image'; src: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result'
      toolUseId: string
      content: string
      isError?: boolean
    }

export interface ChatRequest {
  messages: ChatMessage[]
  tools?: ChatTool[]
  maxTokens?: number
  temperature?: number
  /** System prompt. Providers that don't support it merge into first message. */
  system?: string
}

export type ChatStreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; inputJsonDelta: string }
  | { type: 'tool_use_end'; id: string }
  | { type: 'message_end'; usage: ProviderUsage }
  | { type: 'error'; error: string }

// =========================================================================
// TASK: generateImage
//
// Prompt in, image URL out. For AI-generated backgrounds when the creator
// doesn't supply one.
//
// Primary: Replicate (Flux models). No fallback in V1.
// =========================================================================

export interface GenerateImageRequest {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  /** Optional reference image for img2img. */
  referenceImage?: string
  /** 0..1. Higher = more like the reference. Ignored without a reference. */
  referenceStrength?: number
}

export interface GenerateImageResultData {
  imageUrl: string
  width: number
  height: number
}

export type GenerateImageResult = ProviderResult<GenerateImageResultData>

// =========================================================================
// PROVIDER INTERFACE
//
// All methods are optional. A provider implements only what it does well.
// The router knows which providers can do what based on which methods are
// defined.
// =========================================================================

export interface AIProvider {
  readonly name: ProviderName

  analyzeScript?(
    req: AnalyzeScriptRequest,
    signal?: AbortSignal,
  ): Promise<AnalyzeScriptResult>

  analyzeReference?(
    req: AnalyzeReferenceRequest,
    signal?: AbortSignal,
  ): Promise<AnalyzeReferenceResult>

  analyzeLayouts?(
    req: AnalyzeLayoutsRequest,
    signal?: AbortSignal,
  ): Promise<AnalyzeLayoutsResult>

  identifyFont?(
    req: IdentifyFontRequest,
    signal?: AbortSignal,
  ): Promise<IdentifyFontResult>

  embed?(req: EmbedRequest, signal?: AbortSignal): Promise<EmbedResult>

  chat?(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk>

  generateImage?(
    req: GenerateImageRequest,
    signal?: AbortSignal,
  ): Promise<GenerateImageResult>
}

// =========================================================================
// TASK TYPE INDEX
//
// Lets the router accept a task name as a string and infer request/result
// types. Saves us from writing six overloads of `run()`.
// =========================================================================

export type TaskName =
  | 'analyzeScript'
  | 'analyzeReference'
  | 'analyzeLayouts'
  | 'identifyFont'
  | 'embed'
  | 'chat'
  | 'generateImage'

export type TaskRequest<T extends TaskName> = T extends 'analyzeScript'
  ? AnalyzeScriptRequest
  : T extends 'analyzeReference'
    ? AnalyzeReferenceRequest
    : T extends 'analyzeLayouts'
      ? AnalyzeLayoutsRequest
      : T extends 'identifyFont'
        ? IdentifyFontRequest
        : T extends 'embed'
          ? EmbedRequest
          : T extends 'chat'
            ? ChatRequest
            : T extends 'generateImage'
              ? GenerateImageRequest
              : never

export type TaskResult<T extends TaskName> = T extends 'analyzeScript'
  ? AnalyzeScriptResult
  : T extends 'analyzeReference'
    ? AnalyzeReferenceResult
    : T extends 'analyzeLayouts'
      ? AnalyzeLayoutsResult
      : T extends 'identifyFont'
        ? IdentifyFontResult
        : T extends 'embed'
          ? EmbedResult
          : T extends 'chat'
            ? AsyncIterable<ChatStreamChunk>
            : T extends 'generateImage'
              ? GenerateImageResult
              : never
