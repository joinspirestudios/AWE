/**
 * OpenAI provider — embeddings only.
 *
 * We use OpenAI exclusively for text-embedding-3-small. It's cheap
 * ($0.02 per 1M tokens), fast, and 1536 dimensions is plenty for our
 * similarity needs. Sticking to one embedding model is intentional:
 * mixing models invalidates the vector index.
 */

import OpenAI from 'openai'
import type {
  AIProvider,
  EmbedRequest,
  EmbedResult,
  ProviderName,
} from '../types'

const DEFAULT_MODEL = 'text-embedding-3-small'
/** Dimensions returned by text-embedding-3-small at default settings. */
const DEFAULT_DIMENSIONS = 1536

export interface OpenAIProviderOptions {
  apiKey: string
  defaultModel?: string
}

export class OpenAIProvider implements AIProvider {
  readonly name: ProviderName = 'openai'
  private client: OpenAI
  private model: string

  constructor(opts: OpenAIProviderOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey })
    this.model = opts.defaultModel ?? DEFAULT_MODEL
  }

  async embed(_req: EmbedRequest, _signal?: AbortSignal): Promise<EmbedResult> {
    // TODO: this.client.embeddings.create({ model, input })
    // Return { embeddings: [...], dimensions: DEFAULT_DIMENSIONS }
    throw new Error('OpenAIProvider.embed not implemented')
  }
}
