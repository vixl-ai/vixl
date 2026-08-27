import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import type { PricingSource } from '@/types/billing/pricing-source'
import type {
  VixlCustomProviderModel,
  VixlSettings,
} from '@/types/vixl/vixl-settings'
import { getCustomProvider } from '@/services/providers/registry'
import { getModelCatalogMeta } from '@/services/models/model-catalog-meta'

type ResolvedModelPricing = {
  rates: ModelPricingRates
  source: Extract<PricingSource, 'user_configured' | 'catalog_estimate'>
}

const ratesFromPricing = (pricing: ModelPricingRates): ModelPricingRates => {
  const rates: ModelPricingRates = {
    inputPerMillion: pricing.inputPerMillion,
    outputPerMillion: pricing.outputPerMillion,
  }
  if (pricing.cacheReadPerMillion !== undefined) {
    rates.cacheReadPerMillion = pricing.cacheReadPerMillion
  }
  if (pricing.cacheWritePerMillion !== undefined) {
    rates.cacheWritePerMillion = pricing.cacheWritePerMillion
  }
  if (pricing.reasoningPerMillion !== undefined) {
    rates.reasoningPerMillion = pricing.reasoningPerMillion
  }
  return rates
}

/**
 * Resolve model pricing: user-configured custom rates, then catalogMeta estimate.
 */
export default (input: {
  providerId: string
  modelId: string
  settings: VixlSettings
  customModel?: VixlCustomProviderModel
}): ResolvedModelPricing | null => {
  const model =
    input.customModel ??
    getCustomProvider(input.settings, input.providerId)?.models?.find(
      (entry) => entry.id === input.modelId,
    )

  if (model?.pricing) {
    return {
      rates: ratesFromPricing(model.pricing),
      source: 'user_configured',
    }
  }

  const catalogPricing = getModelCatalogMeta(input.settings, {
    providerId: input.providerId,
    modelId: input.modelId,
  }).pricing
  if (!catalogPricing) {
    return null
  }

  return {
    rates: ratesFromPricing(catalogPricing),
    source: 'catalog_estimate',
  }
}
