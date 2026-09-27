import { describe, expect, it } from 'vitest'
import formatCatalogPricingParts from '@/services/models/options/format-pricing-parts'
import formatCatalogPricing from '@/services/models/options/format-pricing'

describe('formatCatalogPricingParts', () => {
  it('formats required input and output as USD per 1M', () => {
    expect(
      formatCatalogPricingParts({
        inputPerMillion: 2.5,
        outputPerMillion: 10,
      }),
    ).toEqual({
      input: '$2.50',
      output: '$10.00',
    })
  })

  it('omits optional rates when they are undefined', () => {
    const parts = formatCatalogPricingParts({
      inputPerMillion: 3,
      outputPerMillion: 15,
    })
    expect(parts.cacheRead).toBeUndefined()
    expect(parts.cacheWrite).toBeUndefined()
    expect(parts.reasoning).toBeUndefined()
  })

  it('formats cache and reasoning rates when present', () => {
    expect(
      formatCatalogPricingParts({
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        cacheWritePerMillion: 3.75,
        reasoningPerMillion: 15,
      }),
    ).toEqual({
      input: '$3.00',
      output: '$15.00',
      cacheRead: '$0.30',
      cacheWrite: '$3.75',
      reasoning: '$15.00',
    })
  })

  it('formats zero as $0.00', () => {
    expect(
      formatCatalogPricingParts({
        inputPerMillion: 0,
        outputPerMillion: 0,
        cacheReadPerMillion: 0,
        cacheWritePerMillion: 0,
        reasoningPerMillion: 0,
      }),
    ).toEqual({
      input: '$0.00',
      output: '$0.00',
      cacheRead: '$0.00',
      cacheWrite: '$0.00',
      reasoning: '$0.00',
    })
  })

  it('keeps two decimal places for fractional cents', () => {
    expect(
      formatCatalogPricingParts({
        inputPerMillion: 0.15,
        outputPerMillion: 0.6,
        cacheReadPerMillion: 0.075,
        reasoningPerMillion: 1.255,
      }),
    ).toEqual({
      input: '$0.15',
      output: '$0.60',
      cacheRead: '$0.08',
      reasoning: '$1.26',
    })
  })
})

describe('formatCatalogPricing', () => {
  it('preserves the compact in/out per 1M contract', () => {
    expect(
      formatCatalogPricing({ inputPerMillion: 2.5, outputPerMillion: 10 }),
    ).toBe('$2.50 in / $10.00 out per 1M')
  })

  it('returns an empty string when pricing is missing', () => {
    expect(formatCatalogPricing(undefined)).toBe('')
  })

  it('does not include cache or reasoning in the compact string', () => {
    expect(
      formatCatalogPricing({
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        reasoningPerMillion: 15,
      }),
    ).toBe('$3.00 in / $15.00 out per 1M')
  })
})
