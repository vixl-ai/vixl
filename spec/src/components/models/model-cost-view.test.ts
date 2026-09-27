import { describe, expect, it } from 'vitest'
import { buildModelCost } from '@/components/models/model-cost-view'
import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'

const pricing: ModelPricingRates = {
  inputPerMillion: 2.5,
  outputPerMillion: 10,
  cacheReadPerMillion: 0.25,
  cacheWritePerMillion: 3.75,
  reasoningPerMillion: 15,
}

describe('buildModelCost', () => {
  it('returns null when rates are missing', () => {
    expect(
      buildModelCost({
        meta: { vision: true },
        option: {},
      }),
    ).toBeNull()
  })

  it('formats input, output, cache, and reasoning per 1M', () => {
    expect(
      buildModelCost({
        meta: { pricing },
        option: {},
      }),
    ).toEqual({
      estimated: false,
      lines: [
        {
          key: 'input',
          label: 'Input',
          value: '$2.50',
          tooltip: 'Input per 1M tokens',
        },
        {
          key: 'output',
          label: 'Output',
          value: '$10.00',
          tooltip: 'Output per 1M tokens',
        },
        {
          key: 'cacheRead',
          label: 'Cache read',
          value: '$0.25',
          tooltip: 'Cache read per 1M tokens',
        },
        {
          key: 'cacheWrite',
          label: 'Cache write',
          value: '$3.75',
          tooltip: 'Cache write per 1M tokens',
        },
        {
          key: 'reasoning',
          label: 'Reasoning',
          value: '$15.00',
          tooltip: 'Reasoning per 1M tokens',
        },
      ],
    })
  })

  it('hides the reasoning rate when option.reasoning is none', () => {
    const view = buildModelCost({
      meta: { pricing },
      option: { reasoning: 'none' },
    })
    expect(view?.lines.some((line) => line.key === 'reasoning')).toBe(false)
  })

  it('marks estimated without prefixing values when fastPricing is missing', () => {
    expect(
      buildModelCost({
        meta: { pricing },
        option: { fast: true },
      }),
    ).toEqual({
      estimated: true,
      lines: [
        {
          key: 'input',
          label: 'Input',
          value: '$2.50',
          tooltip: 'Input per 1M tokens',
        },
        {
          key: 'output',
          label: 'Output',
          value: '$10.00',
          tooltip: 'Output per 1M tokens',
        },
        {
          key: 'cacheRead',
          label: 'Cache read',
          value: '$0.25',
          tooltip: 'Cache read per 1M tokens',
        },
        {
          key: 'cacheWrite',
          label: 'Cache write',
          value: '$3.75',
          tooltip: 'Cache write per 1M tokens',
        },
        {
          key: 'reasoning',
          label: 'Reasoning',
          value: '$15.00',
          tooltip: 'Reasoning per 1M tokens',
        },
      ],
    })
  })
})
