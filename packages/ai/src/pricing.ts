/**
 * Pricing tables for provider cost estimation.
 *
 * Prices are USD per 1,000,000 tokens. Update when providers change
 * pricing. These are estimates — actual billing is on the provider's
 * invoice. We use these for in-app telemetry only.
 *
 * Cached input tokens (prompt caching) are typically priced at 10% of
 * regular input. Output tokens have no cache discount.
 */

interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
}

const CLAUDE_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-opus-4-6': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-4-5-20251001': { inputPerMillion: 1, outputPerMillion: 5 },
}

const GEMINI_PRICING: Record<string, ModelPricing> = {
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10 },
  'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
}

const OPENAI_PRICING: Record<string, ModelPricing> = {
  'text-embedding-3-small': { inputPerMillion: 0.02, outputPerMillion: 0 },
  'text-embedding-3-large': { inputPerMillion: 0.13, outputPerMillion: 0 },
}

export function estimateClaudeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
): number {
  const p = CLAUDE_PRICING[model]
  if (!p) return 0
  // Anthropic reports these as separate fields. inputTokens excludes both
  // cache reads and cache writes — they're tracked independently.
  const inputCost = (inputTokens * p.inputPerMillion) / 1_000_000
  const cacheWriteCost =
    (cacheCreationTokens * p.inputPerMillion * 1.25) / 1_000_000
  const cacheReadCost =
    (cacheReadTokens * p.inputPerMillion * 0.1) / 1_000_000
  const outputCost = (outputTokens * p.outputPerMillion) / 1_000_000
  return inputCost + cacheWriteCost + cacheReadCost + outputCost
}

export function estimateGeminiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = GEMINI_PRICING[model]
  if (!p) return 0
  return (
    (inputTokens * p.inputPerMillion + outputTokens * p.outputPerMillion) /
    1_000_000
  )
}

export function estimateOpenAICost(model: string, inputTokens: number): number {
  const p = OPENAI_PRICING[model]
  if (!p) return 0
  return (inputTokens * p.inputPerMillion) / 1_000_000
}
