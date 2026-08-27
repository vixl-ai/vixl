import { describe, expect, it } from 'vitest'
import formatTokenCount from '@/services/models/options/format-token-count'
import formatCatalogPricing from '@/services/models/options/format-pricing'
import formatCatalogMetaHint from '@/services/models/options/format-meta-hint'
import parseCatalogTokenOverride from '@/services/models/options/parse-token-override'
import formatModelSearchSuffix from '@/services/models/options/format-search-suffix'

describe('formatTokenCount', () => {
  it('uses k and M for even thousands', () => {
    expect(formatTokenCount(200_000)).toBe('200k')
    expect(formatTokenCount(1_000_000)).toBe('1M')
    expect(formatTokenCount(8_192)).toBe('8,192')
  })
})

describe('parseCatalogTokenOverride', () => {
  it('clears empty and rejects non-integers', () => {
    expect(parseCatalogTokenOverride('')).toBeUndefined()
    expect(parseCatalogTokenOverride('  ')).toBeUndefined()
    expect(parseCatalogTokenOverride('12.5')).toBeUndefined()
    expect(parseCatalogTokenOverride('-8')).toBeUndefined()
  })

  it('caps to reported max when present', () => {
    expect(parseCatalogTokenOverride('64000')).toBe(64_000)
    expect(parseCatalogTokenOverride('500000', 200_000)).toBe(200_000)
    expect(parseCatalogTokenOverride('500000')).toBe(500_000)
  })
})

describe('formatCatalogMetaHint', () => {
  it('builds reported helper lines including compact pricing', () => {
    expect(
      formatCatalogMetaHint({
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        vision: true,
        toolCalling: true,
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
      }),
    ).toEqual([
      'Reported context: 200k',
      'Reported max output: 8,192',
      'Vision, Tools',
      `${formatCatalogPricing({ inputPerMillion: 2.5, outputPerMillion: 10 })}`,
    ])
  })

  it('omits unknown and false capability fields', () => {
    expect(formatCatalogMetaHint({ vision: false, toolCalling: false })).toEqual(
      [],
    )
  })
})

describe('formatModelSearchSuffix', () => {
  it('includes effective context when reported or overridden', () => {
    expect(
      formatModelSearchSuffix({
        option: { reasoning: 'high', fast: true, contextWindow: 64_000 },
        reportedContextWindow: 200_000,
        fastFromModelId: false,
      }),
    ).toBe('64k, high, fast')

    expect(
      formatModelSearchSuffix({
        option: {},
        reportedContextWindow: 200_000,
        fastFromModelId: false,
      }),
    ).toBe('200k')
  })
})
