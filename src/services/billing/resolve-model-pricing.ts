import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import type {
  VixlCustomProviderModel,
  VixlSettings,
} from '@/types/vixl/vixl-settings'
import { getCustomProvider } from '@/services/providers/registry'

/**
 * Resolve user-configured model pricing rates.
 * Catalog estimate lookup is a later slice; this returns null when none found.
 */
export default (input: {
  providerId: string
  modelId: string
  settings: VixlSettings
  customModel?: VixlCustomProviderModel
}): ModelPricingRates | null => {
  const model =
    input.customModel ??
    getCustomProvider(input.settings, input.providerId)?.models?.find(
      (entry) => entry.id === input.modelId,
    )

  const pricing = model?.pricing
  if (!pricing) {
    return null
  }

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
