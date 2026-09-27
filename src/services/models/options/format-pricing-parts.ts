import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export type CatalogPricingParts = {
  input: string
  output: string
  cacheRead?: string
  cacheWrite?: string
  reasoning?: string
}

const formatCatalogPricingParts = (
  pricing: ModelPricingRates,
): CatalogPricingParts => {
  const parts: CatalogPricingParts = {
    input: usd.format(pricing.inputPerMillion),
    output: usd.format(pricing.outputPerMillion),
  }
  if (pricing.cacheReadPerMillion !== undefined) {
    parts.cacheRead = usd.format(pricing.cacheReadPerMillion)
  }
  if (pricing.cacheWritePerMillion !== undefined) {
    parts.cacheWrite = usd.format(pricing.cacheWritePerMillion)
  }
  if (pricing.reasoningPerMillion !== undefined) {
    parts.reasoning = usd.format(pricing.reasoningPerMillion)
  }
  return parts
}

export default formatCatalogPricingParts
