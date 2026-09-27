import { describe, expect, it } from 'vitest'
import modelsDevCatalogSchema, {
  type ModelsDevCatalog,
} from '@/schemas/models/models-dev-catalog'
import mergeModelsDevCatalogMeta, {
  catalogMetaFromModelsDev,
  fillCatalogMetaGaps,
} from '@/services/models/models-dev/meta'

const catalog = (value: unknown): ModelsDevCatalog => {
  const parsed = modelsDevCatalogSchema.safeParse(value)
  expect(parsed.success).toBe(true)
  if (!parsed.success) {
    throw new Error('expected catalog fixture to parse')
  }
  return parsed.data
}

const opusCatalog = () =>
  catalog({
    anthropic: {
      models: {
        'claude-opus-4-6': {
          modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
          cost: {
            input: 5,
            output: 25,
            cache_read: 0.5,
            cache_write: 6.25,
            reasoning: 25,
          },
          limit: { context: 200000, output: 32000 },
          tool_call: true,
          reasoning: true,
          extra_unknown: true,
          experimental: {
            modes: {
              fast: {
                cost: {
                  input: 10,
                  output: 50,
                  cache_read: 1,
                  cache_write: 12.5,
                },
                provider: { body: { speed: 'fast' } },
              },
            },
          },
        },
        'text-only': {
          modalities: { input: ['text'] },
          cost: { input: 1, output: 2 },
          tool_call: false,
        },
      },
    },
    nearai: {
      models: {
        'kimi-k2': {
          cost: { input: 0.6, output: 2.5 },
          limit: { context: 131072 },
        },
      },
    },
    nvidia: {
      api: 'https://integrate.api.nvidia.com/v1',
      models: {
        'meta/llama-3.1-8b-instruct': {
          cost: { input: 0.1, output: 0.1 },
          tool_call: true,
        },
      },
    },
    vercel: {
      npm: '@ai-sdk/gateway',
      models: {
        'openai/gpt-4o': {
          cost: { input: 2.5, output: 10 },
          modalities: { input: ['text', 'image'] },
        },
      },
    },
  })

describe('models.dev catalog schema', () => {
  it('parses cost, limits, tool_call, reasoning, and experimental mode cost', () => {
    const parsed = opusCatalog()
    const model = parsed.anthropic?.models?.['claude-opus-4-6']
    expect(model?.cost).toMatchObject({
      input: 5,
      output: 25,
      cache_read: 0.5,
      cache_write: 6.25,
      reasoning: 25,
    })
    expect(model?.limit).toMatchObject({ context: 200000, output: 32000 })
    expect(model?.tool_call).toBe(true)
    expect(model?.reasoning).toBe(true)
    expect(model?.experimental?.modes?.fast?.cost).toMatchObject({
      input: 10,
      output: 50,
    })
  })

  it('ignores unknown fields and invalid optional shapes', () => {
    const parsed = modelsDevCatalogSchema.safeParse({
      openai: {
        api: 'https://api.openai.com/v1',
        env: ['OPENAI_API_KEY'],
        models: {
          'gpt-4o': {
            cost: { input: 'free', output: 10 },
            tool_call: 'yes',
            modalities: { input: ['text'] },
          },
        },
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.openai?.models?.['gpt-4o']?.cost).toBeUndefined()
    expect(parsed.data?.openai?.models?.['gpt-4o']?.tool_call).toBeUndefined()
    expect(parsed.data?.openai?.models?.['gpt-4o']?.modalities?.input).toEqual([
      'text',
    ])
  })
})

describe('catalogMetaFromModelsDev', () => {
  it('maps models.dev fields onto ModelCatalogMeta including fastPricing', () => {
    const patches = catalogMetaFromModelsDev(opusCatalog(), [
      { providerId: 'anthropic', modelId: 'claude-opus-4-6' },
      { providerId: 'anthropic', modelId: 'text-only' },
    ])

    expect(patches['anthropic::claude-opus-4-6']).toEqual({
      contextWindow: 200000,
      maxOutputTokens: 32000,
      pricing: {
        inputPerMillion: 5,
        outputPerMillion: 25,
        cacheReadPerMillion: 0.5,
        cacheWritePerMillion: 6.25,
        reasoningPerMillion: 25,
      },
      fastPricing: {
        inputPerMillion: 10,
        outputPerMillion: 50,
        cacheReadPerMillion: 1,
        cacheWritePerMillion: 12.5,
      },
      vision: true,
      toolCalling: true,
    })
    expect(patches['anthropic::text-only']).toEqual({
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      vision: false,
      toolCalling: false,
    })
  })

  it('extracts fastPricing from a fast-like mode name when exact fast is absent', () => {
    const patches = catalogMetaFromModelsDev(
      catalog({
        openai: {
          models: {
            'gpt-5': {
              cost: { input: 2, output: 8 },
              experimental: {
                modes: {
                  'fast-tier': { cost: { input: 4, output: 16 } },
                  priority: { cost: { input: 6, output: 24 } },
                },
              },
            },
          },
        },
      }),
      [{ providerId: 'openai', modelId: 'gpt-5' }],
    )
    expect(patches['openai::gpt-5']?.fastPricing).toEqual({
      inputPerMillion: 4,
      outputPerMillion: 16,
    })
  })

  it('does not treat a non-fast experimental mode as fastPricing', () => {
    const patches = catalogMetaFromModelsDev(
      catalog({
        openai: {
          models: {
            'gpt-5': {
              experimental: {
                modes: {
                  priority: { cost: { input: 6, output: 24 } },
                },
              },
            },
          },
        },
      }),
      [{ providerId: 'openai', modelId: 'gpt-5' }],
    )
    expect(patches['openai::gpt-5']?.fastPricing).toBeUndefined()
  })

  it('resolves provider keys dynamically before building patches', () => {
    const patches = catalogMetaFromModelsDev(opusCatalog(), [
      { providerId: 'near-ai', modelId: 'kimi-k2' },
      { providerId: 'nvidia-nim', modelId: 'meta/llama-3.1-8b-instruct' },
      { providerId: 'gateway', modelId: 'openai/gpt-4o' },
    ])
    expect(patches['near-ai::kimi-k2']?.pricing).toEqual({
      inputPerMillion: 0.6,
      outputPerMillion: 2.5,
    })
    expect(patches['near-ai::kimi-k2']?.contextWindow).toBe(131072)
    expect(patches['nvidia-nim::meta/llama-3.1-8b-instruct']?.toolCalling).toBe(
      true,
    )
    expect(patches['gateway::openai/gpt-4o']).toEqual({
      pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
      vision: true,
    })
  })
})

describe('fillCatalogMetaGaps', () => {
  it('fills only fields that are still missing', () => {
    const current = {
      'anthropic::claude-opus-4-6': {
        vision: false,
        pricing: { inputPerMillion: 9, outputPerMillion: 9 },
      },
    }
    const next = fillCatalogMetaGaps(
      current,
      catalogMetaFromModelsDev(opusCatalog(), [
        { providerId: 'anthropic', modelId: 'claude-opus-4-6' },
      ]),
    )

    expect(next['anthropic::claude-opus-4-6']).toEqual({
      vision: false,
      pricing: { inputPerMillion: 9, outputPerMillion: 9 },
      contextWindow: 200000,
      maxOutputTokens: 32000,
      fastPricing: {
        inputPerMillion: 10,
        outputPerMillion: 50,
        cacheReadPerMillion: 1,
        cacheWritePerMillion: 12.5,
      },
      toolCalling: true,
    })
    expect(current['anthropic::claude-opus-4-6']).toEqual({
      vision: false,
      pricing: { inputPerMillion: 9, outputPerMillion: 9 },
    })
  })

  it('never overwrites a defined catalogMeta value', () => {
    const current = {
      'anthropic::claude-opus-4-6': {
        contextWindow: 1,
        maxOutputTokens: 2,
        pricing: { inputPerMillion: 3, outputPerMillion: 4 },
        fastPricing: { inputPerMillion: 5, outputPerMillion: 6 },
        vision: false,
        toolCalling: false,
      },
    }
    const next = mergeModelsDevCatalogMeta(current, opusCatalog(), [
      { providerId: 'anthropic', modelId: 'claude-opus-4-6' },
    ])
    expect(next).toBe(current)
    expect(next['anthropic::claude-opus-4-6']).toEqual(
      current['anthropic::claude-opus-4-6'],
    )
  })

  it('adds a new ref when catalogMeta has no entry yet', () => {
    const next = mergeModelsDevCatalogMeta({}, opusCatalog(), [
      { providerId: 'anthropic', modelId: 'text-only' },
    ])
    expect(next['anthropic::text-only']?.pricing).toEqual({
      inputPerMillion: 1,
      outputPerMillion: 2,
    })
  })
})
