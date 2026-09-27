import { describe, expect, it } from 'vitest'
import mergeCatalogMetaFromCustomProviders from '@/services/models/merge-catalog-meta-from-custom'
import mergeModelsDevCatalogMeta from '@/services/models/models-dev/meta'
import modelsDevCatalogSchema from '@/schemas/models/models-dev-catalog'
import type { ModelCatalogMetaMap } from '@/types/models/model-catalog-meta'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const settings = (overrides: Partial<VixlSettings> = {}): VixlSettings => ({
  version: 1,
  ...overrides,
})

describe('mergeCatalogMetaFromCustomProviders', () => {
  it('writes user-configured catalog fields including fastPricing', () => {
    const next = mergeCatalogMetaFromCustomProviders(
      settings({
        'providers.custom.local': {
          type: 'openai-compatible',
          name: 'Local',
          baseURL: 'http://127.0.0.1:8080/v1',
          models: [
            {
              id: 'opus',
              contextWindow: 64000,
              vision: false,
              pricing: { inputPerMillion: 1, outputPerMillion: 2 },
              fastPricing: { inputPerMillion: 3, outputPerMillion: 4 },
            },
          ],
        },
      }),
      {},
    )

    expect(next['local::opus']).toEqual({
      contextWindow: 64000,
      vision: false,
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      fastPricing: { inputPerMillion: 3, outputPerMillion: 4 },
    })
  })

  it('lets user-configured fields win over a later models.dev gap-fill', () => {
    const custom = mergeCatalogMetaFromCustomProviders(
      settings({
        'providers.custom.anthropic': {
          type: 'openai-compatible',
          name: 'Anthropic Proxy',
          baseURL: 'http://127.0.0.1:8080/v1',
          models: [
            {
              id: 'claude-opus-4-6',
              pricing: { inputPerMillion: 1, outputPerMillion: 2 },
              fastPricing: { inputPerMillion: 3, outputPerMillion: 4 },
              vision: false,
            },
          ],
        },
      }),
      {} as ModelCatalogMetaMap,
    )
    const parsed = modelsDevCatalogSchema.parse({
      anthropic: {
        models: {
          'claude-opus-4-6': {
            modalities: { input: ['text', 'image'] },
            cost: { input: 5, output: 25 },
            experimental: {
              modes: { fast: { cost: { input: 10, output: 50 } } },
            },
            tool_call: true,
            limit: { context: 200000 },
          },
        },
      },
    })
    const next = mergeModelsDevCatalogMeta(custom, parsed, [
      { providerId: 'anthropic', modelId: 'claude-opus-4-6' },
    ])

    expect(next['anthropic::claude-opus-4-6']).toEqual({
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      fastPricing: { inputPerMillion: 3, outputPerMillion: 4 },
      vision: false,
      contextWindow: 200000,
      toolCalling: true,
    })
  })
})
