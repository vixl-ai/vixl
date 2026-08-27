import { describe, expect, it } from 'vitest'
import {
  getModelCatalogMeta,
  mergeModelCatalogMeta,
} from '@/services/models/model-catalog-meta'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const settings = (overrides: Partial<VixlSettings> = {}): VixlSettings => ({
  version: 1,
  ...overrides,
})

const ref = { providerId: 'openai', modelId: 'gpt-4o' }

describe('mergeModelCatalogMeta', () => {
  it('merges by serialized providerId::modelId', () => {
    const next = mergeModelCatalogMeta(settings(), ref, {
      contextWindow: 128000,
      vision: true,
      toolCalling: true,
      pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
    })
    expect(next['openai::gpt-4o']).toEqual({
      contextWindow: 128000,
      vision: true,
      toolCalling: true,
      pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
    })
  })

  it('does not wipe models.catalogOptions', () => {
    const current = settings({
      'models.catalogOptions': {
        'openai::gpt-4o': { fast: true, contextWindow: 64000 },
      },
      'models.catalogMeta': {
        'openai::gpt-4o': { vision: false },
      },
    })
    const catalogOptions = current['models.catalogOptions']
    const nextMeta = mergeModelCatalogMeta(current, ref, {
      contextWindow: 128000,
      vision: true,
    })

    expect(current['models.catalogOptions']).toBe(catalogOptions)
    expect(current['models.catalogOptions']).toEqual({
      'openai::gpt-4o': { fast: true, contextWindow: 64000 },
    })
    expect(nextMeta['openai::gpt-4o']).toEqual({
      vision: true,
      contextWindow: 128000,
    })
    expect(current['models.catalogMeta']).toEqual({
      'openai::gpt-4o': { vision: false },
    })
  })

  it('omits empty and invalid cap fields', () => {
    const current = settings({
      'models.catalogMeta': {
        'openai::gpt-4o': {
          contextWindow: 128000,
          maxOutputTokens: 4096,
          vision: true,
        },
      },
    })

    const cleared = mergeModelCatalogMeta(current, ref, {
      contextWindow: undefined,
      maxOutputTokens: undefined,
    })
    expect(cleared['openai::gpt-4o']).toEqual({ vision: true })

    const invalid = mergeModelCatalogMeta(current, ref, {
      contextWindow: 0,
      maxOutputTokens: 1.5,
    })
    expect(invalid['openai::gpt-4o']).toEqual({ vision: true })
  })

  it('drops the serialized key when the entry is empty', () => {
    const current = settings({
      'models.catalogMeta': {
        'openai::gpt-4o': { vision: true },
      },
    })
    const next = mergeModelCatalogMeta(current, ref, { vision: undefined })
    expect(next['openai::gpt-4o']).toBeUndefined()
    expect(next).toEqual({})
  })
})

describe('getModelCatalogMeta', () => {
  it('returns empty object when missing', () => {
    expect(getModelCatalogMeta(settings(), ref)).toEqual({})
  })

  it('reads by serialized ref string', () => {
    const current = settings({
      'models.catalogMeta': {
        'openai::gpt-4o': { toolCalling: true },
      },
    })
    expect(getModelCatalogMeta(current, 'openai::gpt-4o').toolCalling).toBe(true)
  })
})
