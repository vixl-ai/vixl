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
          inputPerMillion: 1,
          outputPerMillion: 2,
        },
      },
    ],
  },
} as VixlSettings

const usageWithTokens = (raw?: JSONObject): LanguageModelUsage => ({
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
  raw,
})

describe('recordBillableUsage', () => {
  it('prefers provider-reported cost over user-configured rates', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'openrouter',
      modelId: 'test-model',
      usage: usageWithTokens({ cost: 0.42 }),
      settings: settingsWithRates,
    })

    expect(record.costUSD).toBe(0.42)
    expect(record.pricingSource).toBe('provider_reported')
    expect(record.rates).toBeUndefined()
  })

  it('marks missing usage without inventing tokens or $0', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'openai',
      modelId: 'gpt-4o',
      usage: undefined,
      settings: { version: 1 },
    })

    expect(record.usageMissing).toBe(true)
    expect(record.costUSD).toBeNull()
    expect(record.pricingSource).toBe('none')
    expect(record.usage.inputTokens).toBeUndefined()
    expect(record.usage.outputTokens).toBeUndefined()
  })

  it('leaves gateway cost null for async enrich when raw has no cost', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ prompt_tokens: 10 }),
      settings: { version: 1 },
    })

    expect(record.costUSD).toBeNull()
    expect(record.pricingSource).toBe('none')
    expect(record.usage.inputTokens).toBe(1_000_000)
  })

  it('uses string costs from providerMetadata.gateway as provider_reported', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ prompt_tokens: 10 }),
      providerMetadata: {
        gateway: {
          cost: '0.00849',
          marketCost: '0.00849',
          gatewayCost: '0.00849',
          generationId: 'gen_test',
        },
      },
      settings: { version: 1 },
    })

    expect(record.costUSD).toBe(0.00849)
    expect(record.pricingSource).toBe('provider_reported')
    expect(record.rates).toBeUndefined()
  })

  it('prefers marketCost for BYOK gateway metadata over total cost', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ prompt_tokens: 10 }),
      providerMetadata: {
        gateway: {
          isByok: true,
          cost: '0',
          gatewayCost: '0',
          marketCost: '0.00849',
          generationId: 'gen_byok',
        },
      },
      settings: { version: 1 },
    })

    expect(record.costUSD).toBe(0.00849)
    expect(record.pricingSource).toBe('provider_reported')
  })

  it('prefers gateway metadata cost over raw OpenAI-compatible cost', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ cost: 0.99 }),
      providerMetadata: {
        gateway: {
          cost: '0.00849',
          marketCost: '0.00849',
        },
      },
      settings: { version: 1 },
    })

    expect(record.costUSD).toBe(0.00849)
    expect(record.pricingSource).toBe('provider_reported')
  })

  it('uses catalogMeta.pricing as catalog_estimate after custom rates', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'openai',
      modelId: 'gpt-4o',
      usage: usageWithTokens(),
      settings: {
        version: 1,
        'models.catalogMeta': {
          'openai::gpt-4o': {
            pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
          },
        },
      } as VixlSettings,
    })

    expect(record.pricingSource).toBe('catalog_estimate')
    expect(record.costUSD).toBe(2.5 + 5)
    expect(record.rates).toEqual({
      inputPerMillion: 2.5,
      outputPerMillion: 10,
    })
  })

  it('prefers custom rates over catalogMeta.pricing', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'openrouter',
      modelId: 'test-model',
      usage: usageWithTokens(),
      settings: {
        ...settingsWithRates,
        'models.catalogMeta': {
          'openrouter::test-model': {
            pricing: { inputPerMillion: 99, outputPerMillion: 99 },
          },
        },
      } as VixlSettings,
    })

    expect(record.pricingSource).toBe('user_configured')
    expect(record.costUSD).toBe(2)
    expect(record.rates).toEqual({
      inputPerMillion: 1,
      outputPerMillion: 2,
    })
  })

  it('prefers gateway metadata cost over catalog_estimate', () => {
    const record = recordBillableUsage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ prompt_tokens: 10 }),
      providerMetadata: {
        gateway: {
          cost: '0.00849',
          marketCost: '0.00849',
        },
      },
      settings: {
        version: 1,
        'models.catalogMeta': {
          'gateway::openai/gpt-4o': {
            pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
          },
        },
      } as VixlSettings,
    })

    expect(record.costUSD).toBe(0.00849)
    expect(record.pricingSource).toBe('provider_reported')
    expect(record.rates).toBeUndefined()
  })
})
