import { describe, expect, it } from 'vitest'
import mergeExtraModels from '@/services/models/merge-extra-models'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'

const openaiGroup = (): ProviderModelGroup => ({
  providerId: 'openai',
  providerName: 'OpenAI',
  models: [
    { providerId: 'openai', modelId: 'gpt-4o' },
    { providerId: 'openai', modelId: 'gpt-4o-mini' },
  ],
})

describe('mergeExtraModels', () => {
  it('prepends missing extras onto an existing provider group', () => {
    const groups = [openaiGroup()]

    const next = mergeExtraModels(groups, ['openai::o3'])

    expect(next).toEqual([
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        models: [
          { providerId: 'openai', modelId: 'o3' },
          { providerId: 'openai', modelId: 'gpt-4o' },
          { providerId: 'openai', modelId: 'gpt-4o-mini' },
        ],
      },
    ])
    expect(groups[0]?.models).toEqual([
      { providerId: 'openai', modelId: 'gpt-4o' },
      { providerId: 'openai', modelId: 'gpt-4o-mini' },
    ])
  })

  it('skips already-present models', () => {
    const groups = [openaiGroup()]

    const next = mergeExtraModels(groups, ['openai::gpt-4o', 'openai::o3'])

    expect(next[0]?.models).toEqual([
      { providerId: 'openai', modelId: 'o3' },
      { providerId: 'openai', modelId: 'gpt-4o' },
      { providerId: 'openai', modelId: 'gpt-4o-mini' },
    ])
  })

  it('creates a group when the provider is absent', () => {
    const groups = [openaiGroup()]

    const next = mergeExtraModels(groups, ['anthropic::claude-sonnet-4-5'])

    expect(next).toEqual([
      {
        providerId: 'anthropic',
        providerName: 'anthropic',
        models: [{ providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }],
      },
      openaiGroup(),
    ])
  })

  it('ignores malformed refs', () => {
    const groups = [openaiGroup()]

    const next = mergeExtraModels(groups, [
      'nocolon',
      'openai:gpt-4o',
      '::o3',
      'openai::',
      '',
    ])

    expect(next).toEqual([openaiGroup()])
  })
})
