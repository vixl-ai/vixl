import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'

export type ModelCatalogMeta = {
  contextWindow?: number
  maxOutputTokens?: number
  pricing?: ModelPricingRates
  fastPricing?: ModelPricingRates
  vision?: boolean
  toolCalling?: boolean
}

export type ModelCatalogMetaMap = Record<string, ModelCatalogMeta>
