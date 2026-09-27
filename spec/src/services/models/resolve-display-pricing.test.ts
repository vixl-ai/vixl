import { describe, expect, it } from 'vitest'
import resolveDisplayPricing from '@/services/models/options/resolve-display-pricing'
import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'

const base: ModelPricingRates = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  reasoningPerMillion: 15,
}

const fast: ModelPricingRates = {
  inputPerMillion: 4.5,
  outputPerMillion: 22.5,
  reasoningPerMillion: 22.5,
}

describe('resolveDisplayPricing', () => {
  it('returns null rates when meta is missing', () => {
    expect(
      resolveDisplayPricing({ meta: undefined, option: { fast: true } }),
    ).toEqual({
      rates: null,
      fastEstimated: false,
      showReasoningRate: false,
    })
  })

  it('returns null rates when pricing and fastPricing are both missing', () => {
    expect(
      resolveDisplayPricing({
        meta: { vision: true },
        option: { fast: true, reasoning: 'high' },
      }),
    ).toEqual({
      rates: null,
      fastEstimated: false,
      showReasoningRate: false,
    })
  })

  it('uses fastPricing when fast is on and fastPricing exists', () => {
    expect(
      resolveDisplayPricing({
        meta: { pricing: base, fastPricing: fast },
        option: { fast: true },
      }),
    ).toEqual({
      rates: fast,
      fastEstimated: false,
      showReasoningRate: true,
    })
  })

  it('falls back to base pricing and marks estimated when fast is on without fastPricing', () => {
    expect(
      resolveDisplayPricing({
        meta: { pricing: base },
        option: { fast: true },
      }),
    ).toEqual({
      rates: base,
      fastEstimated: true,
      showReasoningRate: true,
    })
  })

  it('uses base pricing when fast is off even if fastPricing exists', () => {
    expect(
      resolveDisplayPricing({
        meta: { pricing: base, fastPricing: fast },
        option: { fast: false },
      }),
    ).toEqual({
      rates: base,
      fastEstimated: false,
      showReasoningRate: true,
    })
  })

  it('uses base pricing when option is missing', () => {
    expect(
      resolveDisplayPricing({
        meta: { pricing: base, fastPricing: fast },
        option: undefined,
      }),
    ).toEqual({
      rates: base,
      fastEstimated: false,
      showReasoningRate: true,
    })
  })

  it('returns null rates when only fastPricing exists and fast is off', () => {
    expect(
      resolveDisplayPricing({
        meta: { fastPricing: fast },
        option: {},
      }),
    ).toEqual({
      rates: null,
      fastEstimated: false,
      showReasoningRate: false,
    })
  })

  it('hides the reasoning rate when option.reasoning is none', () => {
    expect(
      resolveDisplayPricing({
        meta: { pricing: base },
        option: { reasoning: 'none' },
      }),
    ).toEqual({
      rates: base,
      fastEstimated: false,
      showReasoningRate: false,
    })
  })

  it('shows the reasoning rate for provider-default and explicit levels', () => {
    expect(
      resolveDisplayPricing({
        meta: { pricing: base },
        option: { reasoning: 'provider-default' },
      }).showReasoningRate,
    ).toBe(true)
    expect(
      resolveDisplayPricing({
        meta: { pricing: base },
        option: { reasoning: 'high' },
      }).showReasoningRate,
    ).toBe(true)
  })

  it('inherits cache and reasoning from base when fastPricing is input/output only', () => {
    expect(
      resolveDisplayPricing({
        meta: {
          pricing: {
            inputPerMillion: 3,
            outputPerMillion: 15,
            cacheReadPerMillion: 0.3,
            cacheWritePerMillion: 3.75,
            reasoningPerMillion: 15,
          },
          fastPricing: { inputPerMillion: 4.5, outputPerMillion: 22.5 },
        },
        option: { fast: true },
      }),
    ).toEqual({
      rates: {
        inputPerMillion: 4.5,
        outputPerMillion: 22.5,
        cacheReadPerMillion: 0.3,
        cacheWritePerMillion: 3.75,
        reasoningPerMillion: 15,
      },
      fastEstimated: false,
      showReasoningRate: true,
    })
  })

  it('lets fast cache rates override base cache rates', () => {
    expect(
      resolveDisplayPricing({
        meta: {
          pricing: {
            inputPerMillion: 3,
            outputPerMillion: 15,
            cacheReadPerMillion: 0.3,
            cacheWritePerMillion: 3.75,
          },
          fastPricing: {
            inputPerMillion: 4.5,
            outputPerMillion: 22.5,
            cacheReadPerMillion: 0.6,
            cacheWritePerMillion: 7.5,
          },
        },
        option: { fast: true },
      }),
    ).toEqual({
      rates: {
        inputPerMillion: 4.5,
        outputPerMillion: 22.5,
        cacheReadPerMillion: 0.6,
        cacheWritePerMillion: 7.5,
      },
      fastEstimated: false,
      showReasoningRate: false,
    })
  })

  it('inherits reasoning from base when fastPricing omits it', () => {
    expect(
      resolveDisplayPricing({
        meta: {
          pricing: { ...base, cacheReadPerMillion: 0.3 },
          fastPricing: { inputPerMillion: 4.5, outputPerMillion: 22.5 },
        },
        option: { fast: true },
      }),
    ).toEqual({
      rates: {
        inputPerMillion: 4.5,
        outputPerMillion: 22.5,
        cacheReadPerMillion: 0.3,
        reasoningPerMillion: 15,
      },
      fastEstimated: false,
      showReasoningRate: true,
    })
  })

  it('hides the reasoning rate when rates have no reasoningPerMillion', () => {
    expect(
      resolveDisplayPricing({
        meta: {
          pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
        },
        option: { reasoning: 'high' },
      }),
    ).toEqual({
      rates: { inputPerMillion: 2.5, outputPerMillion: 10 },
      fastEstimated: false,
      showReasoningRate: false,
    })
  })
})
