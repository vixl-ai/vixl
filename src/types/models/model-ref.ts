import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import type { ReasoningLevel } from '@/types/models/reasoning-level'

export type ModelRef = {
  providerId: string
  modelId: string
  name?: string
  /** True when a -fast / -highspeed sibling exists in the provider catalog. */
  supportsFast?: boolean
  /** Explicit fast slug when known (e.g. moonshotai/kimi-k3-fast). */
  fastModelId?: string
  /** Provider-reported portable reasoning effort levels, when known. */
  supportsReasoningEffort?: ReasoningLevel[]
  /** True when the provider requires a reasoning effort for this model. */
  reasoningMandatory?: boolean
  /** Provider-reported context window in tokens, when known. */
  contextWindow?: number
  /** Provider-reported max output tokens, when known. */
  maxOutputTokens?: number
  /** USD per 1M tokens, converted from provider per-token rates when known. */
  pricing?: ModelPricingRates
  /** True when the provider reports image/vision input. */
  vision?: boolean
  /** True when the provider reports tool calling. */
  toolCalling?: boolean
}

export const MODEL_REF_SEPARATOR = '::'
