import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const { loadProviderModelsCatalog, listConfiguredProviders } = vi.hoisted(() => ({
  loadProviderModelsCatalog: vi.fn<() => Promise<ProviderModelGroup[]>>(),
  listConfiguredProviders: vi.fn<() => string[]>(),
}))

vi.mock('@/services/models/catalog-cache', () => ({
  default: loadProviderModelsCatalog,
}))

vi.mock('@/services/providers/list-configured-providers', () => ({
  default: listConfiguredProviders,
}))

import resolveSpawnModel from '@/services/harness/subagent/resolve-spawn-model'

const catalog: ProviderModelGroup[] = [
  {
    providerId: 'anthropic',
    providerName: 'Anthropic',
    models: [
      { providerId: 'anthropic', modelId: 'claude-sonnet-4' },
      { providerId: 'anthropic', modelId: 'claude-opus-4' },
    ],
  },
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    models: [{ providerId: 'openai', modelId: 'gpt-4o' }],
  },
]

const settings = {
  version: 1,
  'models.subagent': 'anthropic::claude-sonnet-4',
} as VixlSettings

describe('resolveSpawnModel', () => {
  beforeEach(() => {
    loadProviderModelsCatalog.mockReset()
    listConfiguredProviders.mockReset()
    loadProviderModelsCatalog.mockResolvedValue(catalog)
    listConfiguredProviders.mockReturnValue(['anthropic', 'openai'])
  })

  it('lets per-call ref win over lock', async () => {
    await expect(
      resolveSpawnModel({
        callModel: 'openai::gpt-4o',
        lockedModel: 'anthropic::claude-sonnet-4',
        frontmatterModel: 'anthropic::claude-opus-4',
        settings,
      }),
    ).resolves.toBe('openai::gpt-4o')
  })

  it('throws on fuzzy model and mentions resolve_models', async () => {
    await expect(
      resolveSpawnModel({
        callModel: 'sonnet',
        lockedModel: 'anthropic::claude-sonnet-4',
        settings,
      }),
    ).rejects.toThrow(/resolve_models/)
  })

  it('throws when the exact per-call ref is allowed:false and does not fall back to lock', async () => {
    const disabled = {
      ...settings,
      'models.catalogOptions': {
        'anthropic::claude-sonnet-4': { allowed: false },
      },
    } as VixlSettings

    await expect(
      resolveSpawnModel({
        callModel: 'anthropic::claude-sonnet-4',
        lockedModel: 'openai::gpt-4o',
        settings: disabled,
      }),
    ).rejects.toThrow(/not allowed/)
  })

  it('throws for an unknown provider', async () => {
    await expect(
      resolveSpawnModel({
        callModel: 'missing::claude-sonnet-4',
        settings,
      }),
    ).rejects.toThrow(/Unknown provider/)
  })

  it('throws for an unknown model id', async () => {
    await expect(
      resolveSpawnModel({
        callModel: 'anthropic::not-a-real-model',
        settings,
      }),
    ).rejects.toThrow(/Unknown model/)
  })

  it('uses lock when call model is omitted', async () => {
    await expect(
      resolveSpawnModel({
        lockedModel: 'openai::gpt-4o',
        frontmatterModel: 'anthropic::claude-opus-4',
        settings,
      }),
    ).resolves.toBe('openai::gpt-4o')
  })

  it('uses frontmatter when call model and lock are omitted', async () => {
    await expect(
      resolveSpawnModel({
        frontmatterModel: 'anthropic::claude-opus-4',
        settings,
      }),
    ).resolves.toBe('anthropic::claude-opus-4')
  })

  it('uses settings when call model, lock, and frontmatter are omitted', async () => {
    await expect(
      resolveSpawnModel({
        settings,
      }),
    ).resolves.toBe('anthropic::claude-sonnet-4')
  })
})
