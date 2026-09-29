import { describe, expect, it, vi } from 'vitest'
import {
  resolveCompactHighWater,
  resolveCompactWindow,
} from '@/services/harness/compact/prompt-high-water'
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  resolveContextWindow,
  resolveModelCallOptions,
} from '@/services/models/resolve-model-call-options'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

vi.mock('tokenlens', () => ({
  getContext: () => ({ maxInput: 99_000, maxTotal: 100_000 }),
}))

const ref = { providerId: 'openai', modelId: 'gpt-4o' }

describe('resolveCompactWindow', () => {
  it('shares resolveContextWindow including catalogMeta', () => {
    const settings = {
      version: 1,
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 200_000 },
      },
    } as VixlSettings
    expect(resolveCompactWindow(settings, ref)).toBe(
      resolveContextWindow(settings, ref),
    )
    expect(resolveCompactWindow(settings, ref)).toBe(200_000)
  })

  it('uses tokenlens when catalog and custom are unset', () => {
    expect(resolveCompactWindow({ version: 1 }, ref)).toBe(99_000)
  })
})

describe('resolveCompactHighWater reserved output', () => {
  it('subtracts resolveModelCallOptions maxOutputTokens', () => {
    const settings = {
      version: 1,
      'models.catalogOptions': {
        'openai::gpt-4o': { contextWindow: 100_000, maxOutputTokens: 10_000 },
      },
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 200_000, maxOutputTokens: 16_384 },
      },
    } as VixlSettings
    const reserved =
      resolveModelCallOptions(settings, ref, {
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      }).maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
    expect(reserved).toBe(10_000)
    expect(resolveCompactHighWater(settings, ref)).toBe(
      Math.floor((100_000 - 10_000) * 0.7),
    )
  })

  it('subtracts the 32768 main-agent default when no catalog max output is set', () => {
    const settings = {
      version: 1,
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 200_000 },
      },
    } as VixlSettings
    expect(resolveCompactHighWater(settings, ref)).toBe(
      Math.floor((200_000 - DEFAULT_MAX_OUTPUT_TOKENS) * 0.7),
    )
  })

  it('uses the half-window fallback so a 32k context still has a positive high water', () => {
    const settings = {
      version: 1,
      'models.catalogOptions': {
        'openai::gpt-4o': { contextWindow: 32_768 },
      },
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 32_768 },
      },
    } as VixlSettings
    expect(resolveCompactHighWater(settings, ref)).toBe(
      Math.floor((32_768 - 16_384) * 0.7),
    )
  })

  it('uses the half-window fallback on a 40k context', () => {
    const settings = {
      version: 1,
      'models.catalogOptions': {
        'openai::gpt-4o': { contextWindow: 40_000 },
      },
      'models.catalogMeta': {
        'openai::gpt-4o': { contextWindow: 40_000 },
      },
    } as VixlSettings
    expect(resolveCompactHighWater(settings, ref)).toBe(
      Math.floor((40_000 - 20_000) * 0.7),
    )
  })
})
