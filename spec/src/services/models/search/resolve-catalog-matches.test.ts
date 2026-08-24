import { describe, expect, it } from 'vitest'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { resolveCatalogMatches } from '@/services/models/search'
import serializeModelRef from '@/utils/serialize-model-ref'

const catalog: ProviderModelGroup[] = [
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    models: [
      { providerId: 'openai', modelId: 'gpt-4o' },
      { providerId: 'openai', modelId: 'gpt-4o-mini' },
      { providerId: 'openai', modelId: 'o3-mini' },
      { providerId: 'openai', modelId: 'gpt-4.1' },
      { providerId: 'openai', modelId: 'gpt-4.1-mini' },
      { providerId: 'openai', modelId: 'o1' },
      { providerId: 'openai', modelId: 'o1-mini' },
      { providerId: 'openai', modelId: 'gpt-3.5-turbo' },
      { providerId: 'openai', modelId: 'text-embedding-3-small' },
    ],
  },
  {
    providerId: 'anthropic',
    providerName: 'Anthropic',
    models: [
      { providerId: 'anthropic', modelId: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
      { providerId: 'anthropic', modelId: 'claude-opus-4' },
      {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-disabled',
        name: 'Disabled Top Hit',
      },
    ],
  },
  {
    providerId: 'small',
    providerName: 'Small Provider',
    models: [
      { providerId: 'small', modelId: 'one' },
      { providerId: 'small', modelId: 'two' },
    ],
  },
]

const baseSettings = {
  version: 1,
} as VixlSettings

describe('resolveCatalogMatches', () => {
  it('rejects empty query and provider', () => {
    const result = resolveCatalogMatches(catalog, baseSettings, {})
    expect(result).toEqual({
      matches: [],
      error: 'Provide a query or provider',
    })
  })

  it('rejects whitespace-only query and provider', () => {
    const result = resolveCatalogMatches(catalog, baseSettings, {
      query: '  ',
      provider: '\t',
    })
    expect(result).toEqual({
      matches: [],
      error: 'Provide a query or provider',
    })
  })

  it('caps matches at 8', () => {
    const wide: ProviderModelGroup[] = [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        models: Array.from({ length: 10 }, (_, index) => ({
          providerId: 'openai',
          modelId: `gpt-extra-${index}`,
        })),
      },
    ]
    const result = resolveCatalogMatches(wide, baseSettings, {
      query: 'gpt',
    })
    expect('matches' in result && result.matches).toBeTruthy()
    if (!('matches' in result)) {
      return
    }
    expect(result.matches.length).toBeLessThanOrEqual(8)
    expect(result.matches.length).toBe(8)
  })

  it('returns needs_query for provider-only when more than 8 allowed models', () => {
    const result = resolveCatalogMatches(catalog, baseSettings, {
      provider: 'openai',
    })
    expect(result).toMatchObject({
      status: 'needs_query',
      providerId: 'openai',
      count: 9,
    })
    expect('suggested' in result ? result.suggested : undefined).toBeUndefined()
  })

  it('includes suggested on needs_query when subagent model is allowed on that provider', () => {
    const settings = {
      version: 1,
      'models.subagent': 'openai::gpt-4o',
    } as VixlSettings
    const result = resolveCatalogMatches(catalog, settings, {
      provider: 'OpenAI',
    })
    expect(result).toMatchObject({
      status: 'needs_query',
      providerId: 'openai',
      count: 9,
      suggested: 'openai::gpt-4o',
    })
  })

  it('omits suggested when settings model is on a different provider', () => {
    const settings = {
      version: 1,
      'models.subagent': 'anthropic::claude-sonnet-4',
    } as VixlSettings
    const result = resolveCatalogMatches(catalog, settings, {
      provider: 'openai',
    })
    expect(result).toMatchObject({
      status: 'needs_query',
      providerId: 'openai',
    })
    expect('suggested' in result ? result.suggested : undefined).toBeUndefined()
  })

  it('sets best for an exact id or name match', () => {
    const result = resolveCatalogMatches(catalog, baseSettings, {
      query: 'claude-sonnet-4',
    })
    expect('matches' in result).toBe(true)
    if ('error' in result || !('matches' in result)) {
      return
    }
    expect(result.best).toBe('anthropic::claude-sonnet-4')
    expect(result.matches[0]?.ref).toBe('anthropic::claude-sonnet-4')
  })

  it('sets best when a single model remains after provider filter', () => {
    const single: ProviderModelGroup[] = [
      {
        providerId: 'solo',
        providerName: 'Solo',
        models: [{ providerId: 'solo', modelId: 'only-one' }],
      },
    ]
    const result = resolveCatalogMatches(single, baseSettings, {
      provider: 'solo',
    })
    expect(result).toEqual({
      matches: [
        {
          ref: 'solo::only-one',
          name: 'Only One',
          providerId: 'solo',
          providerName: 'Solo',
          score: 0,
        },
      ],
      best: 'solo::only-one',
    })
  })

  it('returns provider models when count is at most 8', () => {
    const result = resolveCatalogMatches(catalog, baseSettings, {
      provider: 'small',
    })
    expect('matches' in result).toBe(true)
    if ('error' in result || !('matches' in result)) {
      return
    }
    expect(result.matches).toHaveLength(2)
    expect(result.best).toBeUndefined()
  })

  it('returns error when provider matches nothing', () => {
    const result = resolveCatalogMatches(catalog, baseSettings, {
      provider: 'missing-provider',
    })
    expect(result).toEqual({
      matches: [],
      error: 'No models found for that provider',
    })
  })

  it('omits allowed:false models from matches, best, and suggested', () => {
    const disabledRef = serializeModelRef({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-disabled',
    })
    const settings = {
      version: 1,
      'models.subagent': disabledRef,
      'models.catalogOptions': {
        [disabledRef]: { allowed: false },
        [serializeModelRef({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4',
        })]: { allowed: false },
      },
    } as VixlSettings

    const byName = resolveCatalogMatches(catalog, settings, {
      query: 'Disabled Top Hit',
    })
    expect(byName).toEqual({ matches: [] })

    const byProvider = resolveCatalogMatches(catalog, settings, {
      provider: 'anthropic',
    })
    expect('matches' in byProvider).toBe(true)
    if ('error' in byProvider || !('matches' in byProvider)) {
      return
    }
    expect(byProvider.matches.map((match) => match.ref)).toEqual([
      'anthropic::claude-opus-4',
    ])
    expect(byProvider.best).toBe('anthropic::claude-opus-4')
    expect(byProvider.matches.every((match) => match.ref !== disabledRef)).toBe(
      true,
    )

    const openaiCatalog: ProviderModelGroup[] = [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        models: Array.from({ length: 10 }, (_, index) => ({
          providerId: 'openai',
          modelId: index === 0 ? 'gpt-4o' : `gpt-extra-${index}`,
        })),
      },
    ]
    const openaiSettings = {
      version: 1,
      'models.subagent': 'openai::gpt-4o',
      'models.catalogOptions': {
        'openai::gpt-4o': { allowed: false },
      },
    } as VixlSettings
    const needsQuery = resolveCatalogMatches(openaiCatalog, openaiSettings, {
      provider: 'openai',
    })
    expect(needsQuery).toMatchObject({
      status: 'needs_query',
      providerId: 'openai',
      count: 9,
    })
    expect(
      'suggested' in needsQuery ? needsQuery.suggested : undefined,
    ).toBeUndefined()
  })
})
