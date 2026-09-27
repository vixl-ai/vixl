import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'

const OPTIONAL_RATE_FIELDS = [
  'cacheReadPerMillion',
  'cacheWritePerMillion',
  'reasoningPerMillion',
] as const

/**
 * Fast fields win when defined. Missing fields inherit from base pricing.
 * Required input/output must resolve from either source; otherwise use base.
 */
const mergeFastOverBaseRates = (
  fastRates: ModelPricingRates,
  baseRates: ModelPricingRates | undefined,
): ModelPricingRates | undefined => {
  const inputPerMillion = fastRates.inputPerMillion ?? baseRates?.inputPerMillion
  const outputPerMillion =
    fastRates.outputPerMillion ?? baseRates?.outputPerMillion
  if (inputPerMillion === undefined || outputPerMillion === undefined) {
    return baseRates
  }

  const rates: ModelPricingRates = {
    inputPerMillion,
    outputPerMillion,
  }
  for (const field of OPTIONAL_RATE_FIELDS) {
    const value = fastRates[field] ?? baseRates?.[field]
    if (value !== undefined) {
      rates[field] = value
    }
  }
  return rates
}

export default mergeFastOverBaseRates
