import { describe, expect, it } from 'vitest'
import {
  getModelCatalogOption,
  mergeModelCatalogOption,
} from '@/services/models/model-catalog-options'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const settings = (overrides: Partial<VixlSettings> = {}): VixlSettings => ({
  version: 1,
  ...overrides,
})

const ref = { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }

describe('mergeModelCatalogOption', () => {
  it('stores optional contextWindow and maxOutputTokens', () => {
    const next = mergeModelCatalogOption(settings(), ref, {
      contextWindow: 128000,
      maxOutputTokens: 8192,
    })
    expect(next['anthropic::claude-sonnet-4-5']).toEqual({
      contextWindow: 128000,
      maxOutputTokens: 8192,
    })
  })

  it('omits empty and default cap fields', () => {
    const withCaps: VixlSettings = settings({
      'models.catalogOptions': {
        'anthropic::claude-sonnet-4-5': {
          fast: true,
          contextWindow: 128000,
          maxOutputTokens: 8192,
        },
      },
    })

    const cleared = mergeModelCatalogOption(withCaps, ref, {
      contextWindow: undefined,
      maxOutputTokens: undefined,
    })
    expect(cleared['anthropic::claude-sonnet-4-5']).toEqual({ fast: true })

    const invalid = mergeModelCatalogOption(withCaps, ref, {
      contextWindow: 0,
      maxOutputTokens: -8,
    })
    expect(invalid['anthropic::claude-sonnet-4-5']).toEqual({ fast: true })
  })

  it('does not drop unrelated option fields when merging caps', () => {
    const current = settings({
      'models.catalogOptions': {
        'anthropic::claude-sonnet-4-5': { allowed: false, reasoning: 'high' },
      },
    })
    const next = mergeModelCatalogOption(current, ref, { contextWindow: 200000 })
    expect(next['anthropic::claude-sonnet-4-5']).toEqual({
      allowed: false,
      reasoning: 'high',
      contextWindow: 200000,
    })
  })
})

describe('getModelCatalogOption', () => {
  it('reads caps by serialized providerId::modelId', () => {
    const current = settings({
      'models.catalogOptions': {
        'anthropic::claude-sonnet-4-5': { contextWindow: 200000 },
      },
    })
    expect(getModelCatalogOption(current, ref).contextWindow).toBe(200000)
    expect(getModelCatalogOption(current, 'anthropic::claude-sonnet-4-5').contextWindow).toBe(
      200000,
    )
  })
})
