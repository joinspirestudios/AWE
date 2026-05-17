/**
 * Replicate provider — image generation only.
 *
 * Used when the creator wants an AI-generated background. The model we
 * default to is one of the Flux variants; we can swap by passing
 * `defaultModel`. Replicate is the only viable provider for this task
 * (Anthropic and Google don't expose image generation; OpenAI's gpt-image
 * is an option for later, but Flux is currently better for design backgrounds).
 */

import Replicate from 'replicate'
import type {
  AIProvider,
  GenerateImageRequest,
  GenerateImageResult,
  ProviderName,
} from '../types'

/** Update when a better Flux variant ships on Replicate. */
const DEFAULT_MODEL: `${string}/${string}` = 'black-forest-labs/flux-dev'

export interface ReplicateProviderOptions {
  apiToken: string
  defaultModel?: `${string}/${string}`
}

export class ReplicateProvider implements AIProvider {
  readonly name: ProviderName = 'replicate'
  private client: Replicate
  private model: `${string}/${string}`

  constructor(opts: ReplicateProviderOptions) {
    this.client = new Replicate({ auth: opts.apiToken })
    this.model = opts.defaultModel ?? DEFAULT_MODEL
  }

  async generateImage(
    _req: GenerateImageRequest,
    _signal?: AbortSignal,
  ): Promise<GenerateImageResult> {
    // TODO: this.client.run(this.model, { input: { prompt, width, height, ... } })
    throw new Error('ReplicateProvider.generateImage not implemented')
  }
}
