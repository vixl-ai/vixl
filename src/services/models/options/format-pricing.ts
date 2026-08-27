import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatCatalogPricing = (pricing: ModelPricingRates | undefined): string => {
  if (!pricing) {
    return ''
  }
  return `${usd.format(pricing.inputPerMillion)} in / ${usd.format(pricing.outputPerMillion)} out per 1M`
}

export default formatCatalogPricing
