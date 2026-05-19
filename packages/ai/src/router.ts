/**
 * AI Router
 *
 * Picks the right provider per task with a documented fallback chain.
 * On error, it falls through to the next provider. Every call emits
 * usage telemetry via the `onUsage` hook (wire to PostHog).
 *
 * Usage:
 *
 *   const router = new AIRouter({
 *     providers: [
 *       new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY }),
 *       new GeminiProvider({ apiKey: env.GOOGLE_AI_API_KEY }),
 *       new OpenAIProvider({ apiKey: env.OPENAI_API_KEY }),
 *       new ReplicateProvider({ apiToken: env.REPLICATE_API_TOKEN }),
 *     ],
 *     onUsage: (task, usage) => posthog.capture('ai_call', { task, ...usage }),
 *   })
 *
 *   const { data } = await router.run('analyzeScript', { script })
 *   for await (const chunk of router.stream({ messages, tools })) { ... }
 */

import type {
  AIProvider,
  ChatStreamChunk,
  ProviderName,
  ProviderUsage,
  TaskName,
  TaskRequest,
  TaskResult,
} from './types'

/**
 * Default routing. Order matters — first is primary, rest are fallbacks.
 * Some tasks have only one viable provider; switching them mid-flight
 * would invalidate cached results or vector indexes.
 */
export const DEFAULT_ROUTES: Readonly<Record<TaskName, readonly ProviderName[]>> = {
  analyzeScript: ['claude', 'gemini'],
  analyzeReference: ['gemini', 'claude'],
  analyzeLayouts: ['gemini', 'claude'],
  identifyFont: ['gemini', 'claude'],
  embed: ['openai'],
  chat: ['claude', 'gemini'],
  generateImage: ['replicate'],
}

/**
 * Per-attempt timeout for non-streaming tasks. Sized so a primary that
 * hangs to the wire still leaves room for one fallback within Vercel's
 * 60s Hobby-plan function ceiling (28s + 28s + overhead < 60s).
 */
const PER_ATTEMPT_TIMEOUT_MS = 28_000

export interface RouterOptions {
  providers: AIProvider[]
  /** Override the default routing for any subset of tasks. */
  routes?: Partial<Record<TaskName, readonly ProviderName[]>>
  /** Fires after every successful provider call. Wire to analytics. */
  onUsage?: (task: TaskName, usage: ProviderUsage) => void
  /** Fires when a provider fails (before falling back to the next). */
  onError?: (task: TaskName, provider: ProviderName, error: Error) => void
}

export class AIRouter {
  private providers = new Map<ProviderName, AIProvider>()
  private routes: Record<TaskName, readonly ProviderName[]>
  private onUsage?: RouterOptions['onUsage']
  private onError?: RouterOptions['onError']

  constructor(opts: RouterOptions) {
    for (const p of opts.providers) this.providers.set(p.name, p)
    this.routes = { ...DEFAULT_ROUTES, ...opts.routes }
    this.onUsage = opts.onUsage
    this.onError = opts.onError
  }

  /**
   * Run a non-streaming task. Returns the first provider's successful
   * result. Use `stream()` for chat (streaming tasks).
   *
   * Each provider attempt is wrapped in a per-attempt timeout (default
   * 28s) so a hung primary doesn't burn the entire route budget. Within
   * Vercel's 60s function ceiling, that leaves ~28s for a fallback if
   * the primary hangs to the wire. Caller-supplied AbortSignals are
   * still honored.
   */
  async run<T extends Exclude<TaskName, 'chat'>>(
    task: T,
    request: TaskRequest<T>,
    signal?: AbortSignal,
  ): Promise<TaskResult<T>> {
    const chain = this.routes[task]
    let lastError: Error | undefined

    for (const providerName of chain) {
      const provider = this.providers.get(providerName)
      if (!provider) continue

      const method = (provider as unknown as Record<string, unknown>)[task]
      if (typeof method !== 'function') continue

      // Per-attempt AbortController with a hard timeout. Linked to the
      // caller's signal (if any) so external aborts still propagate.
      const attemptController = new AbortController()
      const onParentAbort = () => attemptController.abort()
      signal?.addEventListener('abort', onParentAbort)
      const timeoutId = setTimeout(
        () => attemptController.abort(),
        PER_ATTEMPT_TIMEOUT_MS,
      )

      try {
        const result = (await (
          method as (
            req: TaskRequest<T>,
            signal?: AbortSignal,
          ) => Promise<TaskResult<T>>
        ).call(provider, request, attemptController.signal)) as TaskResult<T>

        const usage = (result as unknown as { usage?: ProviderUsage }).usage
        if (usage) this.onUsage?.(task, usage)

        return result
      } catch (err) {
        const error = err as Error
        // If our internal timeout fired (and the caller didn't abort),
        // surface a clean per-provider timeout error so logs show why
        // we fell over.
        const isOurTimeout =
          attemptController.signal.aborted && !signal?.aborted
        const wrappedError = isOurTimeout
          ? new Error(
              `Provider ${providerName} exceeded ${PER_ATTEMPT_TIMEOUT_MS}ms timeout (${error.message})`,
            )
          : error
        lastError = wrappedError
        this.onError?.(task, providerName, wrappedError)
        // Caller-initiated abort — stop the whole chain.
        if (signal?.aborted) throw wrappedError
      } finally {
        clearTimeout(timeoutId)
        signal?.removeEventListener('abort', onParentAbort)
      }
    }

    throw new Error(
      `All providers failed for task "${task}": ${
        lastError?.message ?? 'no provider available'
      }`,
    )
  }

  /**
   * Streaming variant for chat. Falls back to the next provider only if
   * the primary fails before yielding any chunks. Once chunks start
   * flowing, errors mid-stream bubble up (we can't seamlessly stitch
   * partial output from two providers).
   */
  async *stream(
    request: TaskRequest<'chat'>,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    const chain = this.routes.chat
    let lastError: Error | undefined

    for (const providerName of chain) {
      const provider = this.providers.get(providerName)
      if (!provider?.chat) continue

      let yieldedAnyChunk = false
      try {
        for await (const chunk of provider.chat(request, signal)) {
          yieldedAnyChunk = true
          if (chunk.type === 'message_end') {
            this.onUsage?.('chat', chunk.usage)
          }
          yield chunk
        }
        return
      } catch (err) {
        const error = err as Error
        lastError = error
        this.onError?.('chat', providerName, error)
        if (signal?.aborted) throw error
        // If we already started streaming, don't silently swap providers.
        if (yieldedAnyChunk) throw error
      }
    }

    throw new Error(
      `All providers failed for chat: ${lastError?.message ?? 'no provider available'}`,
    )
  }

  /** Returns the set of providers currently registered with the router. */
  getRegisteredProviders(): ProviderName[] {
    return Array.from(this.providers.keys())
  }
}
