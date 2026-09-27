import { describe, expect, it } from 'vitest'
import modelsDevCatalogSchema, {
  type ModelsDevCatalog,
} from '@/schemas/models/models-dev-catalog'
import {
  lookupModelsDevModel,
  resolveModelsDevProviderKey,
} from '@/services/models/models-dev/provider-keys'

const catalog = (value: ModelsDevCatalog): ModelsDevCatalog => {
  const parsed = modelsDevCatalogSchema.safeParse(value)
  expect(parsed.success).toBe(true)
  if (!parsed.success) {
    throw new Error('expected catalog fixture to parse')
  }
  return parsed.data
}

describe('resolveModelsDevProviderKey', () => {
  it('resolves an exact catalog key', () => {
    const fixture = catalog({
      openai: { models: { 'gpt-4o': {} } },
      anthropic: { models: { 'claude-sonnet-4-5': {} } },
    })
    expect(resolveModelsDevProviderKey(fixture, 'openai')).toBe('openai')
    expect(resolveModelsDevProviderKey(fixture, 'anthropic')).toBe('anthropic')
    expect(resolveModelsDevProviderKey(fixture, ' google ')).toBeUndefined()
  })

  it('resolves a normalized id when punctuation differs', () => {
    const fixture = catalog({
      nearai: { models: { default: {} } },
      'fireworks-ai': { models: { llama: {} } },
    })
    expect(resolveModelsDevProviderKey(fixture, 'near-ai')).toBe('nearai')
    expect(resolveModelsDevProviderKey(fixture, 'NEAR_AI')).toBe('nearai')
  })

  it('prefers an exact key over a normalized sibling', () => {
    const fixture = catalog({
      fireworks: { models: { native: {} } },
      'fireworks-ai': {
        api: 'https://api.fireworks.ai/inference/v1/',
        models: { hosted: {} },
      },
    })
    expect(resolveModelsDevProviderKey(fixture, 'fireworks')).toBe('fireworks')
  })

  it('resolves by API host when ids do not match', () => {
    const fixture = catalog({
      'fireworks-ai': {
        api: 'https://api.fireworks.ai/inference/v1/',
        models: { llama: {} },
      },
      nvidia: {
        api: 'https://integrate.api.nvidia.com/v1',
        models: { 'meta/llama-3.1-8b-instruct': {} },
      },
    })
    expect(resolveModelsDevProviderKey(fixture, 'fireworks')).toBe('fireworks-ai')
    expect(resolveModelsDevProviderKey(fixture, 'nvidia-nim')).toBe('nvidia')
  })

  it('ignores templated or unparseable api hosts', () => {
    const fixture = catalog({
      neon: {
        api: '${NEON_AI_GATEWAY_BASE_URL}/v1',
        models: { default: {} },
      },
    })
    expect(resolveModelsDevProviderKey(fixture, 'openai')).toBeUndefined()
  })

  it('returns undefined when no package, id, or host match exists', () => {
    const fixture = catalog({
      openai: { models: { 'gpt-4o': {} } },
      vercel: { models: { 'openai/gpt-4o': {} } },
    })
    expect(resolveModelsDevProviderKey(fixture, 'gateway')).toBeUndefined()
    expect(resolveModelsDevProviderKey(fixture, 'acme')).toBeUndefined()
    expect(resolveModelsDevProviderKey(fixture, '')).toBeUndefined()
  })

  it('resolves gateway to vercel via package match, not the vercel id', () => {
    const fixture = catalog({
      vercel: {
        npm: '@ai-sdk/gateway',
        models: { 'openai/gpt-4o': {} },
      },
      v0: {
        npm: '@ai-sdk/vercel',
        models: { 'v0-1.0-md': {} },
      },
    })
    expect(resolveModelsDevProviderKey(fixture, 'gateway')).toBe('vercel')
    expect(resolveModelsDevProviderKey(fixture, 'vercel')).toBe('v0')
  })

  it('rejects an exact id when both sides declare different packages', () => {
    const fixture = catalog({
      vercel: {
        npm: '@ai-sdk/gateway',
        models: { 'openai/gpt-4o': {} },
      },
    })
    expect(resolveModelsDevProviderKey(fixture, 'vercel')).toBeUndefined()
    expect(resolveModelsDevProviderKey(fixture, 'gateway')).toBe('vercel')
  })
})

describe('lookupModelsDevModel', () => {
  it('finds a model after dynamic provider resolution', () => {
    const fixture = catalog({
      nearai: {
        models: {
          'kimi-k2': { tool_call: true },
        },
      },
    })
    expect(lookupModelsDevModel(fixture, 'near-ai', 'kimi-k2')?.tool_call).toBe(
      true,
    )
    expect(lookupModelsDevModel(fixture, 'near-ai', 'missing')).toBeUndefined()
  })

  it('does not match a different-case model id', () => {
    const fixture = catalog({
      openai: {
        models: {
          'gpt-4o': { tool_call: true },
        },
      },
    })
    expect(lookupModelsDevModel(fixture, 'openai', 'gpt-4o')?.tool_call).toBe(true)
    expect(lookupModelsDevModel(fixture, 'openai', 'GPT-4o')).toBeUndefined()
    expect(lookupModelsDevModel(fixture, 'openai', 'Gpt-4o')).toBeUndefined()
  })
})
