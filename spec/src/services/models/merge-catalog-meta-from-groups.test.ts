import { describe, expect, it } from 'vitest'
import mergeCatalogMetaFromGroups from '@/services/models/merge-catalog-meta-from-groups'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const settings = (overrides: Partial<VixlSettings> = {}): VixlSettings => ({
  version: 1,
  ...overrides,
})

describe('mergeCatalogMetaFromGroups', () => {
  it('merges reported ModelRef fields into catalogMeta', () => {
    const groups: ProviderModelGroup[] = [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        models: [
          {
            providerId: 'openai',
            modelId: 'gpt-4o',
            name: 'GPT-4o',
            supportsFast: true,
            contextWindow: 128000,
            maxOutputTokens: 16384,
            pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
            vision: true,
            toolCalling: true,
          },
        ],
      },
      {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        models: [
          {
            providerId: 'anthropic',
            modelId: 'claude-sonnet-4-5',
            contextWindow: 200000,
            vision: false,
          },
        ],
      },
    ]

    const next = mergeCatalogMetaFromGroups(settings(), groups)

    expect(next).toEqual({
      'openai::gpt-4o': {
        contextWindow: 128000,
        maxOutputTokens: 16384,
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
        vision: true,
        toolCalling: true,
      },
      'anthropic::claude-sonnet-4-5': {
        contextWindow: 200000,
        vision: false,
      },
    })
  })

  it('does not clobber catalogOptions', () => {
    const current = settings({
      'models.catalogOptions': {
        'openai::gpt-4o': { fast: true, contextWindow: 64000 },
      },
      'models.catalogMeta': {
        'openai::gpt-4o': { vision: false },
      },
    })
    const catalogOptions = current['models.catalogOptions']
    const groups: ProviderModelGroup[] = [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        models: [
          {
            providerId: 'openai',
            modelId: 'gpt-4o',
            contextWindow: 128000,
            vision: true,
          },
        ],
      },
    ]

    const next = mergeCatalogMetaFromGroups(current, groups)

    expect(current['models.catalogOptions']).toBe(catalogOptions)
    expect(current['models.catalogOptions']).toEqual({
      'openai::gpt-4o': { fast: true, contextWindow: 64000 },
    })
    expect(next['openai::gpt-4o']).toEqual({
      vision: true,
      contextWindow: 128000,
    })
    expect(current['models.catalogMeta']).toEqual({
      'openai::gpt-4o': { vision: false },
    })
  })

  it('persists provider-reported fastPricing onto catalogMeta', () => {
    const groups: ProviderModelGroup[] = [
      {
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        models: [
          {
            providerId: 'openrouter',
            modelId: 'moonshotai/kimi-k3',
            pricing: { inputPerMillion: 1, outputPerMillion: 2 },
            fastPricing: { inputPerMillion: 3, outputPerMillion: 4 },
            supportsFast: true,
            fastModelId: 'moonshotai/kimi-k3-fast',
          },
        ],
      },
    ]

    const next = mergeCatalogMetaFromGroups(settings(), groups)

    expect(next['openrouter::moonshotai/kimi-k3']).toEqual({
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      fastPricing: { inputPerMillion: 3, outputPerMillion: 4 },
    })
  })

  it('leaves catalogMeta.fastPricing alone when the provider omits it', () => {
    const current = settings({
      'models.catalogMeta': {
        'openrouter::moonshotai/kimi-k3': {
          pricing: { inputPerMillion: 1, outputPerMillion: 2 },
          fastPricing: { inputPerMillion: 3, outputPerMillion: 4 },
        },
      },
    })
    const groups: ProviderModelGroup[] = [
      {
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        models: [
          {
            providerId: 'openrouter',
            modelId: 'moonshotai/kimi-k3',
            pricing: { inputPerMillion: 1.5, outputPerMillion: 2.5 },
          },
        ],
      },
    ]

    const next = mergeCatalogMetaFromGroups(current, groups)

    expect(next['openrouter::moonshotai/kimi-k3']).toEqual({
      pricing: { inputPerMillion: 1.5, outputPerMillion: 2.5 },
      fastPricing: { inputPerMillion: 3, outputPerMillion: 4 },
    })
  })

  it('does not write fastPricing when the base row has none', () => {
    const groups: ProviderModelGroup[] = [
      {
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        models: [
          {
            providerId: 'openrouter',
            modelId: 'moonshotai/kimi-k3',
            pricing: { inputPerMillion: 1, outputPerMillion: 2 },
          },
        ],
      },
    ]

    const next = mergeCatalogMetaFromGroups(settings(), groups)

    expect(next['openrouter::moonshotai/kimi-k3']).toEqual({
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
    })
    expect(next['openrouter::moonshotai/kimi-k3']?.fastPricing).toBeUndefined()
  })

  it('updates only refs seen in this refresh', () => {
    const current = settings({
      'models.catalogMeta': {
        'openai::gpt-4o': { vision: true, contextWindow: 64000 },
        'anthropic::claude-sonnet-4-5': { toolCalling: true },
      },
    })
    const groups: ProviderModelGroup[] = [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        models: [
          {
            providerId: 'openai',
            modelId: 'gpt-4o',
            contextWindow: 128000,
          },
        ],
      },
    ]

    const next = mergeCatalogMetaFromGroups(current, groups)

    expect(next).toEqual({
      'openai::gpt-4o': { vision: true, contextWindow: 128000 },
      'anthropic::claude-sonnet-4-5': { toolCalling: true },
    })
  })
})
