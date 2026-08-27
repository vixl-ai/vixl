import { describe, expect, it } from 'vitest'
import clampModelCatalogOption from '@/services/models/clamp-model-catalog-option'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const ref = { providerId: 'openai', modelId: 'gpt-4o' }

describe('clampModelCatalogOption caps', () => {
  it('clamps contextWindow above catalogMeta.contextWindow', () => {
    const settings = {
      version: 1,
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 200_000 },
      },
    } as VixlSettings
    const clamped = clampModelCatalogOption(settings, ref, {
      contextWindow: 500_000,
    })
    expect(clamped.contextWindow).toBe(200_000)
  })

  it('clamps maxOutputTokens above catalogMeta.maxOutputTokens', () => {
    const settings = {
      version: 1,
      'models.catalogMeta': {
        'openai::gpt-4o': { maxOutputTokens: 8_192 },
      },
    } as VixlSettings
    const clamped = clampModelCatalogOption(settings, ref, {
      maxOutputTokens: 32_000,
    })
    expect(clamped.maxOutputTokens).toBe(8_192)
  })

  it('keeps overrides at or below reported', () => {
    const settings = {
      version: 1,
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 200_000, maxOutputTokens: 16_384 },
      },
    } as VixlSettings
    const clamped = clampModelCatalogOption(settings, ref, {
      contextWindow: 64_000,
      maxOutputTokens: 4_096,
    })
    expect(clamped.contextWindow).toBe(64_000)
    expect(clamped.maxOutputTokens).toBe(4_096)
  })

  it('does not clamp when catalogMeta has no reported max', () => {
    const clamped = clampModelCatalogOption({ version: 1 }, ref, {
      contextWindow: 500_000,
      maxOutputTokens: 32_000,
    })
    expect(clamped.contextWindow).toBe(500_000)
    expect(clamped.maxOutputTokens).toBe(32_000)
  })

  it('raises overrides below 1 to 1 when reported exists', () => {
    const settings = {
      version: 1,
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 200_000, maxOutputTokens: 8_192 },
      },
    } as VixlSettings
    const clamped = clampModelCatalogOption(settings, ref, {
      contextWindow: -8,
      maxOutputTokens: 0,
    })
    expect(clamped.contextWindow).toBe(1)
    expect(clamped.maxOutputTokens).toBe(1)
  })
})
