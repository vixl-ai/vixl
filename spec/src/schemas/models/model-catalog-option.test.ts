import { describe, expect, it } from 'vitest'
import { modelCatalogMetaMapSchema } from '@/schemas/models/model-catalog-meta'
import { modelCatalogOptionSchema } from '@/schemas/models/model-catalog-option'
import { validateVixlSettings } from '@/schemas/vixl-settings'

describe('modelCatalogOptionSchema', () => {
  it('accepts optional positive contextWindow and maxOutputTokens', () => {
    const parsed = modelCatalogOptionSchema.safeParse({
      fast: true,
      contextWindow: 200000,
      maxOutputTokens: 8192,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects non-positive cap fields', () => {
    expect(modelCatalogOptionSchema.safeParse({ contextWindow: 0 }).success).toBe(
      false,
    )
    expect(modelCatalogOptionSchema.safeParse({ maxOutputTokens: -1 }).success).toBe(
      false,
    )
    expect(
      modelCatalogOptionSchema.safeParse({ contextWindow: 128.5 }).success,
    ).toBe(false)
  })
})

describe('modelCatalogMetaMapSchema', () => {
  it('accepts catalog meta keyed by serialized ref', () => {
    const parsed = modelCatalogMetaMapSchema.safeParse({
      'anthropic::claude-sonnet-4-5': {
        contextWindow: 200000,
        maxOutputTokens: 8192,
        vision: true,
        toolCalling: true,
        pricing: {
          inputPerMillion: 3,
          outputPerMillion: 15,
        },
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects non-positive cap fields', () => {
    const parsed = modelCatalogMetaMapSchema.safeParse({
      'openai::gpt-4o': { contextWindow: 0 },
    })
    expect(parsed.success).toBe(false)
  })
})

describe('validateVixlSettings catalog maps', () => {
  it('accepts models.catalogMeta alongside models.catalogOptions', () => {
    const result = validateVixlSettings({
      version: 1,
      'models.catalogOptions': {
        'anthropic::claude-sonnet-4-5': { fast: true, contextWindow: 128000 },
      },
      'models.catalogMeta': {
        'anthropic::claude-sonnet-4-5': {
          contextWindow: 200000,
          vision: true,
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid catalogMeta entries', () => {
    const result = validateVixlSettings({
      version: 1,
      'models.catalogMeta': {
        'anthropic::claude-sonnet-4-5': { maxOutputTokens: 0 },
      },
    })
    expect(result.success).toBe(false)
  })
})
