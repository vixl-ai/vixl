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

const pickRates = (
  fastRates: ModelPricingRates | undefined,
  baseRates: ModelPricingRates | undefined,
  fast: boolean | undefined,
): ModelPricingRates | undefined => {
  if (fast === true && fastRates) {
    return fastRates
  }
  return baseRates
}

/**
 * Resolve model pricing: user-configured custom rates, then catalogMeta estimate.
 * When the call is in fast mode, fastPricing wins over base pricing in each source.
 */
export default (input: {
  providerId: string
  modelId: string
  settings: VixlSettings
  customModel?: VixlCustomProviderModel
  fast?: boolean
}): ResolvedModelPricing | null => {
  const model =
    input.customModel ??
    getCustomProvider(input.settings, input.providerId)?.models?.find(
      (entry) => entry.id === input.modelId,
    )

  const customRates = pickRates(model?.fastPricing, model?.pricing, input.fast)
  if (customRates) {
    return {
      rates: ratesFromPricing(customRates),
      source: 'user_configured',
    }
  }

  const catalogMeta = getModelCatalogMeta(input.settings, {
    providerId: input.providerId,
    modelId: input.modelId,
  })
  const catalogRates = pickRates(
    catalogMeta.fastPricing,
    catalogMeta.pricing,
    input.fast,
  )
  if (!catalogRates) {
    return null
  }

  return {
    rates: ratesFromPricing(catalogRates),
    source: 'catalog_estimate',
  }
}
