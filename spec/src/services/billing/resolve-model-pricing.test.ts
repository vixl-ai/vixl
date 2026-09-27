import { describe, expect, it } from 'vitest'
import resolveModelPricing from '@/services/billing/resolve-model-pricing'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const baseRates = { inputPerMillion: 1, outputPerMillion: 2 }
const fastRates = { inputPerMillion: 3, outputPerMillion: 4 }
const catalogBase = { inputPerMillion: 2.5, outputPerMillion: 10 }
const catalogFast = { inputPerMillion: 10, outputPerMillion: 50 }

const settingsWithCustom = {
  version: 1,
  'providers.custom.local': {
    type: 'openai-compatible',
    name: 'Local',
    baseURL: 'http://127.0.0.1:8080/v1',
    models: [
      {
        id: 'opus',
        pricing: baseRates,
        fastPricing: fastRates,
      },
    ],
  },
} as VixlSettings

const settingsWithCatalog = {
  version: 1,
  'models.catalogMeta': {
    'openai::gpt-4o': {
      pricing: catalogBase,
      fastPricing: catalogFast,
    },
  },
} as VixlSettings

describe('resolveModelPricing fast rates', () => {
  it('uses custom fastPricing when fast is on', () => {
    expect(
      resolveModelPricing({
        providerId: 'local',
        modelId: 'opus',
        settings: settingsWithCustom,
        fast: true,
      }),
    ).toEqual({
      rates: fastRates,
      source: 'user_configured',
    })
  })

  it('uses catalogMeta fastPricing when fast is on', () => {
    expect(
      resolveModelPricing({
        providerId: 'openai',
        modelId: 'gpt-4o',
        settings: settingsWithCatalog,
        fast: true,
      }),
    ).toEqual({
      rates: catalogFast,
      source: 'catalog_estimate',
    })
  })

  it('uses custom base pricing when fast is off', () => {
    expect(
      resolveModelPricing({
        providerId: 'local',
        modelId: 'opus',
        settings: settingsWithCustom,
        fast: false,
      }),
    ).toEqual({
      rates: baseRates,
      source: 'user_configured',
    })
  })

  it('uses catalog base pricing when fast is off', () => {
    expect(
      resolveModelPricing({
        providerId: 'openai',
        modelId: 'gpt-4o',
        settings: settingsWithCatalog,
        fast: false,
      }),
    ).toEqual({
      rates: catalogBase,
      source: 'catalog_estimate',
    })
  })

  it('falls back to custom base pricing when fast is on without fastPricing', () => {
    expect(
      resolveModelPricing({
        providerId: 'local',
        modelId: 'opus',
        settings: {
          version: 1,
          'providers.custom.local': {
            type: 'openai-compatible',
            name: 'Local',
            baseURL: 'http://127.0.0.1:8080/v1',
            models: [{ id: 'opus', pricing: baseRates }],
          },
        } as VixlSettings,
        fast: true,
      }),
    ).toEqual({
      rates: baseRates,
      source: 'user_configured',
    })
  })

  it('falls back to catalog base pricing when fast is on without fastPricing', () => {
    expect(
      resolveModelPricing({
        providerId: 'openai',
        modelId: 'gpt-4o',
        settings: {
          version: 1,
          'models.catalogMeta': {
            'openai::gpt-4o': { pricing: catalogBase },
          },
        } as VixlSettings,
        fast: true,
      }),
    ).toEqual({
      rates: catalogBase,
      source: 'catalog_estimate',
    })
  })
})
