import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  FALLBACK_CONTEXT_WINDOW,
  resolveContextWindow,
  resolveModelCallOptions,
} from '@/services/models/resolve-model-call-options'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const TOKENLENS_WINDOW = 99_000

vi.mock('tokenlens', () => ({
  getContext: () => ({ maxInput: TOKENLENS_WINDOW, maxTotal: 100_000 }),
}))

const ref = { providerId: 'openai', modelId: 'gpt-4o' }

const customKat = (model: {
  contextWindow?: number
  maxInputTokens?: number
  maxOutputTokens?: number
}): VixlSettings =>
  ({
    version: 1,
    'providers.custom.kat': {
      type: 'openai-compatible',
      name: 'Kat',
      baseURL: 'http://localhost:1234/v1',
      models: [{ id: 'kat-coder', ...model }],
    },
  }) as VixlSettings

describe('resolveContextWindow precedence', () => {
  it('uses catalogOptions.contextWindow first', () => {
    const settings = {
      version: 1,
      'models.catalogOptions': {
        'openai::gpt-4o': { contextWindow: 64_000 },
      },
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 200_000 },
      },
    } as VixlSettings
    expect(resolveContextWindow(settings, ref)).toBe(64_000)
  })

  it('clamps catalogOptions.contextWindow to catalogMeta when above reported', () => {
    const settings = {
      version: 1,
      'models.catalogOptions': {
        'openai::gpt-4o': { contextWindow: 500_000 },
      },
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 200_000 },
      },
    } as VixlSettings
    expect(resolveContextWindow(settings, ref)).toBe(200_000)
  })

  it('uses custom contextWindow before catalogMeta', () => {
    const settings = {
      ...customKat({ contextWindow: 40_000, maxInputTokens: 32_000 }),
      'models.catalogMeta': {
        'kat::kat-coder': { contextWindow: 128_000 },
      },
    }
    expect(
      resolveContextWindow(settings, { providerId: 'kat', modelId: 'kat-coder' }),
    ).toBe(40_000)
  })

  it('uses custom maxInputTokens when custom contextWindow is unset', () => {
    expect(
      resolveContextWindow(customKat({ maxInputTokens: 32_000 }), {
        providerId: 'kat',
        modelId: 'kat-coder',
      }),
    ).toBe(32_000)
  })

  it('uses catalogMeta.contextWindow before tokenlens', () => {
    const settings = {
      version: 1,
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 200_000 },
      },
    } as VixlSettings
    expect(resolveContextWindow(settings, ref)).toBe(200_000)
  })

  it('uses tokenlens before 128k fallback', () => {
    expect(resolveContextWindow({ version: 1 }, ref)).toBe(TOKENLENS_WINDOW)
  })

  it('falls back to 128k when tokenlens has no window', () => {
    expect(
      resolveContextWindow({ version: 1 }, { providerId: 'openai', modelId: '' }),
    ).toBe(FALLBACK_CONTEXT_WINDOW)
  })
})

describe('resolveModelCallOptions maxOutputTokens precedence', () => {
  it('uses catalogOptions.maxOutputTokens first', () => {
    const settings = {
      version: 1,
      'models.catalogOptions': {
        'openai::gpt-4o': { maxOutputTokens: 4_096 },
      },
      'models.catalogMeta': {
        'openai::gpt-4o': { maxOutputTokens: 16_384 },
      },
    } as VixlSettings
    expect(resolveModelCallOptions(settings, ref).maxOutputTokens).toBe(4_096)
  })

  it('clamps catalogOptions.maxOutputTokens to catalogMeta when above reported', () => {
    const settings = {
      version: 1,
      'models.catalogOptions': {
        'openai::gpt-4o': { maxOutputTokens: 32_000 },
      },
      'models.catalogMeta': {
        'openai::gpt-4o': { maxOutputTokens: 8_192 },
      },
    } as VixlSettings
    expect(resolveModelCallOptions(settings, ref).maxOutputTokens).toBe(8_192)
  })

  it('uses catalogMeta.maxOutputTokens before custom', () => {
    const settings = {
      ...customKat({ maxOutputTokens: 2_048 }),
      'models.catalogMeta': {
        'kat::kat-coder': { maxOutputTokens: 16_384 },
      },
    }
    expect(
      resolveModelCallOptions(settings, { providerId: 'kat', modelId: 'kat-coder' })
        .maxOutputTokens,
    ).toBe(16_384)
  })

  it('uses custom maxOutputTokens before default', () => {
    expect(
      resolveModelCallOptions(customKat({ maxOutputTokens: 4_096 }), {
        providerId: 'kat',
        modelId: 'kat-coder',
      }).maxOutputTokens,
    ).toBe(4_096)
  })

  it('falls back to default 8192', () => {
    expect(
      resolveModelCallOptions({ version: 1 }, ref).maxOutputTokens,
    ).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
  })
})

describe('resolveContextWindow fallback constant', () => {
  it('exports 128k as the last-resort window', () => {
    expect(FALLBACK_CONTEXT_WINDOW).toBe(128_000)
  })
})
