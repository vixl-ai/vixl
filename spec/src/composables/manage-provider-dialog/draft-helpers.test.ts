import { describe, expect, it } from 'vitest'
import {
  createEmptyModel,
  createEmptyPricing,
  draftToPricing,
  modelHasPricingConfigured,
  parseOptionalNumber,
} from '@/composables/manage-provider-dialog/draft-helpers'

describe('draftToPricing', () => {
  it('returns rates when input and output are numbers', () => {
    expect(
      draftToPricing({
        ...createEmptyPricing(),
        inputPerMillion: 3,
        outputPerMillion: 15,
      }),
    ).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
    })
  })

  it('returns undefined for empty strings', () => {
    expect(draftToPricing(createEmptyPricing())).toBeUndefined()
  })

  it('treats 0 as valid pricing', () => {
    expect(
      draftToPricing({
        ...createEmptyPricing(),
        inputPerMillion: 0,
        outputPerMillion: 0,
      }),
    ).toEqual({
      inputPerMillion: 0,
      outputPerMillion: 0,
    })
  })
})

describe('modelHasPricingConfigured', () => {
  it('is true when pricing values are numbers', () => {
    const draft = createEmptyModel()
    draft.pricing.inputPerMillion = 3
    draft.pricing.outputPerMillion = 15
    expect(modelHasPricingConfigured(draft)).toBe(true)
  })

  it('is true when a pricing value is 0', () => {
    const draft = createEmptyModel()
    draft.pricing.inputPerMillion = 0
    expect(modelHasPricingConfigured(draft)).toBe(true)
  })
})

describe('parseOptionalNumber', () => {
  it('parses numeric and string values', () => {
    expect(parseOptionalNumber(15)).toBe(15)
    expect(parseOptionalNumber('15')).toBe(15)
  })
})
