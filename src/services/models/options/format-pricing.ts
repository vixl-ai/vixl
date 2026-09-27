import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import formatCatalogPricingParts from './format-pricing-parts'

const formatCatalogPricing = (pricing: ModelPricingRates | undefined): string => {
  if (!pricing) {
    return ''
  }
  const parts = formatCatalogPricingParts(pricing)
  return `${parts.input} in / ${parts.output} out per 1M`
}

export default formatCatalogPricing
