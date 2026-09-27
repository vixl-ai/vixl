import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import type { ModelCatalogOption } from '@/types/models/model-catalog-option'
import mergeFastOverBaseRates from '@/services/billing/merge-fast-over-base-rates'

export type ResolvedDisplayPricing = {
  rates: ModelPricingRates | null
  fastEstimated: boolean
  showReasoningRate: boolean
}

export type ResolveDisplayPricingInput = {
  meta: ModelCatalogMeta | undefined
  option: ModelCatalogOption | undefined
}

const resolveDisplayPricing = ({
  meta,
  option,
}: ResolveDisplayPricingInput): ResolvedDisplayPricing => {
  const base = meta?.pricing
  const fast = meta?.fastPricing

  if (base === undefined && fast === undefined) {
    return { rates: null, fastEstimated: false, showReasoningRate: false }
  }

  let rates: ModelPricingRates | null
  let fastEstimated = false

  if (option?.fast === true && fast !== undefined) {
    rates = mergeFastOverBaseRates(fast, base) ?? base ?? null
  } else if (option?.fast === true) {
    rates = base ?? null
    fastEstimated = true
  } else {
    rates = base ?? null
  }

  // Show the reasoning rate whenever rates include reasoningPerMillion,
  // unless the user explicitly chose none. Unset and provider-default
  // still show it because the model may still bill reasoning tokens.
  const showReasoningRate =
    rates !== null &&
    rates.reasoningPerMillion !== undefined &&
    option?.reasoning !== 'none'

  return { rates, fastEstimated, showReasoningRate }
}

export default resolveDisplayPricing
