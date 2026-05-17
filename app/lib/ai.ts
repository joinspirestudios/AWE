/**
 * Server-only AI router.
 *
 * Lazily constructs a singleton `AIRouter` from environment variables.
 * Route handlers import `getRouter()` and call `.run()` or `.stream()`.
 *
 * API keys never leave the server because this module is only imported
 * by server code (route handlers, server actions). Anything `NEXT_PUBLIC_*`
 * is intentionally absent.
 */

import 'server-only'

import {
  AIRouter,
  ClaudeProvider,
  GeminiProvider,
  OpenAIProvider,
  ReplicateProvider,
  type AIProvider,
  type ProviderName,
  type ProviderUsage,
  type TaskName,
} from '@app/ai'

let _router: AIRouter | null = null

export function getRouter(): AIRouter {
  if (_router) return _router

  const providers: AIProvider[] = []

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push(
      new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    )
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    providers.push(
      new GeminiProvider({ apiKey: process.env.GOOGLE_AI_API_KEY }),
    )
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push(new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }))
  }
  if (process.env.REPLICATE_API_TOKEN) {
    providers.push(
      new ReplicateProvider({ apiToken: process.env.REPLICATE_API_TOKEN }),
    )
  }

  _router = new AIRouter({
    providers,
    onUsage: (task: TaskName, usage: ProviderUsage) => {
      // TODO: forward to PostHog server-side capture once it's wired.
      console.log(
        `[ai] ${task} via ${usage.provider}/${usage.model} — ${usage.durationMs}ms, $${usage.estimatedCostUsd?.toFixed(5) ?? '0'}`,
      )
    },
    onError: (task: TaskName, provider: ProviderName, error: Error) => {
      console.error(`[ai] ${task} via ${provider} failed:`, error.message)
    },
  })

  return _router
}
