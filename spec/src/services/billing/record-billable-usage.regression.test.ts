import { describe, expect, it } from 'vitest'
import type { LanguageModelUsage } from 'ai'
import type { JSONObject } from '@ai-sdk/provider'
import recordBillableUsage from '@/services/billing/record-billable-usage'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const settingsWithRates = {
  version: 1,
  'providers.custom.openrouter': {
    type: 'openai-compatible',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    models: [
      {
        id: 'test-model',
        pricing: {
          inputPerMillion: 3,
          outputPerMillion: 15,
          cacheReadPerMillion: 0.3,
          cacheWritePerMillion: 3.75,
        },
      },
    ],
  },
} as VixlSettings

const usageWithTokens = (
  patch?: Partial<LanguageModelUsage> & { raw?: JSONObject },
): LanguageModelUsage => ({
  inputTokens: 1_000_000,
  inputTokenDetails: {
    noCacheTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokens: 500_000,
  outputTokenDetails: {
    textTokens: 500_000,
    reasoningTokens: 0,
  },
  totalTokens: 1_500_000,
  raw: patch?.raw,
  ...patch,
})

describe('recordBillableUsage provider-cost regression', () => {
  it('provider-reported cost present => costUSD equals that number exactly (rates unused)', () => {
    // Rate math would be (1M * 3 + 0.5M * 15) / 1M = 10.5; provider cost must win.
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'openrouter',
      modelId: 'test-model',
      usage: usageWithTokens({ raw: { cost: 0.00123 } }),
      settings: settingsWithRates,
      at: '2026-01-01T00:00:00.000Z',
    })

    expect(record.costUSD).toBe(0.00123)
    expect(record.pricingSource).toBe('provider_reported')
    expect(record.rates).toBeUndefined()
  })

  it('missing usage => usageMissing true and costUSD null (not 0)', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'openai',
      modelId: 'gpt-4o',
      usage: undefined,
      settings: { version: 1 },
      at: '2026-01-01T00:00:00.000Z',
    })

    expect(record.usageMissing).toBe(true)
    expect(record.costUSD).toBeNull()
    expect(record.costUSD).not.toBe(0)
    expect(record.pricingSource).toBe('none')
    expect(record.usage.inputTokens).toBeUndefined()
    expect(record.usage.outputTokens).toBeUndefined()
  })

  it('gateway path leaves costUSD null for async enrich (no enrich call here)', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ raw: { prompt_tokens: 10 } }),
      settings: { version: 1 },
      at: '2026-01-01T00:00:00.000Z',
    })

    expect(record.costUSD).toBeNull()
    expect(record.pricingSource).toBe('none')
    expect(record.rates).toBeUndefined()
    expect(record.usage.inputTokens).toBe(1_000_000)
  })

  it('gateway metadata string cost => provider_reported (no async enrich needed)', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ raw: { prompt_tokens: 10 } }),
      providerMetadata: {
        gateway: {
          cost: '0.00123',
          marketCost: '0.00123',
          gatewayCost: '0.00123',
          generationId: 'gen_reg',
        },
      },
      settings: { version: 1 },
      at: '2026-01-01T00:00:00.000Z',
    })

    expect(record.costUSD).toBe(0.00123)
    expect(record.pricingSource).toBe('provider_reported')
    expect(record.rates).toBeUndefined()
  })

  it('gateway BYOK metadata prefers marketCost over zero total', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ raw: { prompt_tokens: 10 } }),
      providerMetadata: {
        gateway: {
          cost: '0',
          gatewayCost: '0',
          marketCost: '0.00456',
          inferenceCost: '0.00456',
        },
      },
      settings: { version: 1 },
      at: '2026-01-01T00:00:00.000Z',
    })

    expect(record.costUSD).toBe(0.00456)
    expect(record.pricingSource).toBe('provider_reported')
  })

  it('exclusive cache math applied when rates used', () => {
    // uncached=1000 @ $3, read=50 @ $0.30, write=50 @ $3.75, output=200 @ $15
    const expected =
      (1000 * 3) / 1_000_000 +
      (50 * 0.3) / 1_000_000 +
      (50 * 3.75) / 1_000_000 +
      (200 * 15) / 1_000_000

    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'openrouter',
      modelId: 'test-model',
      usage: {
        inputTokens: 1100,
        inputTokenDetails: {
          noCacheTokens: 1000,
          cacheReadTokens: 50,
          cacheWriteTokens: 50,
        },
        outputTokens: 200,
        outputTokenDetails: {
          textTokens: 200,
          reasoningTokens: 0,
        },
        totalTokens: 1300,
      },
      settings: settingsWithRates,
      at: '2026-01-01T00:00:00.000Z',
    })

    expect(record.costUSD).toBe(expected)
    expect(record.pricingSource).toBe('user_configured')
    expect(record.rates).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: 3.75,
    })
  })
})
