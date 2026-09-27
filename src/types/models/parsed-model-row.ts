import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import type { ReasoningLevel } from '@/types/models/reasoning-level'

export type ParsedModelRow = {
  id: string
  supportsReasoningEffort?: ReasoningLevel[]
  reasoningMandatory?: boolean
  supportsFast?: boolean
  contextWindow?: number
  maxOutputTokens?: number
  pricing?: ModelPricingRates
  fastPricing?: ModelPricingRates
  vision?: boolean
  toolCalling?: boolean
}
