import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const openaiListed = (): ProviderModelGroup[] => [
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    models: [{ providerId: 'openai', modelId: 'gpt-4o' }],
  },
]

const listAllProviderModels = vi.hoisted(
  () =>
    vi.fn<(settings: VixlSettings) => Promise<ProviderModelGroup[]>>(),
)

const updateSetting = vi.hoisted(
  () =>
    vi.fn<
      (
        scope: 'personal',
        key: 'models.catalogMeta',
        value: unknown,
      ) => Promise<void>
    >(async () => undefined),
)

const loadModelsDevCatalog = vi.hoisted(
  () => vi.fn<() => Promise<unknown>>(async () => undefined),
)

vi.mock('@/services/providers/list-all-provider-models', () => ({
  default: listAllProviderModels,
}))

vi.mock('@/services/models/models-dev/catalog', () => ({
  default: loadModelsDevCatalog,
}))

vi.mock('@/composables/use-vixl-config', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    default: () => ({
      personalSettings: vueRef({ version: 1 } as VixlSettings),
      updateSetting,
    }),
  }
})

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

import { toast } from 'vue-sonner'

describe('use-provider-models-catalog', () => {
  beforeEach(() => {
    listAllProviderModels.mockReset()
    listAllProviderModels.mockResolvedValue(openaiListed())
    loadModelsDevCatalog.mockReset()
    loadModelsDevCatalog.mockResolvedValue(undefined)
    updateSetting.mockReset()
    updateSetting.mockResolvedValue(undefined)
    vi.mocked(toast.error).mockClear()
  })

  it('merges extraModelRefs locally without relisting or setting loading', async () => {
    const { default: useProviderModelsCatalog } = await import(
      '@/composables/use-provider-models-catalog'
    )
    const extraModelRefs = ref<string[]>([])
    const settings = ref<VixlSettings>({
      version: 1,
      'providers.openai.apiKeyRef': 'openai',
    })
    const { groups, loading } = useProviderModelsCatalog({
      settings,
      extraModelRefs,
    })

    await vi.waitFor(() => {
      expect(listAllProviderModels).toHaveBeenCalledTimes(1)
      expect(loading.value).toBe(false)
    })

    extraModelRefs.value = ['openai::gpt-4o-mini']
    await nextTick()

    expect(listAllProviderModels).toHaveBeenCalledTimes(1)
    expect(loading.value).toBe(false)
    expect(
      groups.value
        .find((group) => group.providerId === 'openai')
        ?.models.some((model) => model.modelId === 'gpt-4o-mini'),
    ).toBe(true)
  })

  it('relists when a provider apiKeyRef changes', async () => {
    const { default: useProviderModelsCatalog } = await import(
      '@/composables/use-provider-models-catalog'
    )
    const extraModelRefs = ref<string[]>([])
    const settings = ref<VixlSettings>({
      version: 1,
      'providers.openai.apiKeyRef': 'openai',
    })
    useProviderModelsCatalog({
      settings,
      extraModelRefs,
    })

    await vi.waitFor(() => {
      expect(listAllProviderModels).toHaveBeenCalledTimes(1)
    })

    settings.value = {
      ...settings.value,
      'providers.anthropic.apiKeyRef': 'anthropic',
    }

    await vi.waitFor(() => {
      expect(listAllProviderModels).toHaveBeenCalledTimes(2)
    })
  })

  it('does not persist catalogMeta from a superseded generation', async () => {
    const { default: useProviderModelsCatalog } = await import(
      '@/composables/use-provider-models-catalog'
    )
    let releaseFirstCatalog: (value: unknown) => void = () => undefined
    const firstCatalog = new Promise<unknown>((resolve) => {
      releaseFirstCatalog = resolve
    })
    loadModelsDevCatalog
      .mockImplementationOnce(async () => firstCatalog)
      .mockResolvedValue(undefined)
    listAllProviderModels
      .mockResolvedValueOnce(openaiListed())
      .mockResolvedValueOnce([
        {
          providerId: 'anthropic',
          providerName: 'Anthropic',
          models: [
            {
              providerId: 'anthropic',
              modelId: 'claude-sonnet-4-5',
              contextWindow: 200000,
            },
          ],
        },
      ])

    const settings = ref<VixlSettings>({
      version: 1,
      'providers.openai.apiKeyRef': 'openai',
    })
    useProviderModelsCatalog({ settings })

    await vi.waitFor(() => {
      expect(loadModelsDevCatalog).toHaveBeenCalledTimes(1)
    })

    settings.value = {
      version: 1,
      'providers.openai.apiKeyRef': 'openai',
      'providers.anthropic.apiKeyRef': 'anthropic',
    }

    await vi.waitFor(() => {
      expect(listAllProviderModels).toHaveBeenCalledTimes(2)
      expect(updateSetting).toHaveBeenCalledWith(
        'personal',
        'models.catalogMeta',
        { 'anthropic::claude-sonnet-4-5': { contextWindow: 200000 } },
      )
    })

    const writes = updateSetting.mock.calls.length
    releaseFirstCatalog({
      openai: {
        models: {
          'gpt-4o': {
            cost: { input: 1, output: 2 },
            modalities: { input: ['text', 'image'] },
          },
        },
      },
    })
    await nextTick()
    await Promise.resolve()

    expect(updateSetting).toHaveBeenCalledTimes(writes)
    expect(
      updateSetting.mock.calls.some(([, key, value]) => {
        return (
          key === 'models.catalogMeta' &&
          Boolean(
            value &&
              typeof value === 'object' &&
              'openai::gpt-4o' in (value as Record<string, unknown>),
          )
        )
      }),
    ).toBe(false)
  })

  it('persists collapsed fast sibling pricing as catalogMeta.fastPricing', async () => {
    listAllProviderModels.mockResolvedValue([
      {
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        models: [
          {
            providerId: 'openrouter',
            modelId: 'moonshotai/kimi-k3',
            pricing: { inputPerMillion: 1, outputPerMillion: 2 },
          },
          {
            providerId: 'openrouter',
            modelId: 'moonshotai/kimi-k3-fast',
            pricing: { inputPerMillion: 3, outputPerMillion: 4 },
          },
        ],
      },
    ])
    const { default: useProviderModelsCatalog } = await import(
      '@/composables/use-provider-models-catalog'
    )
    const settings = ref<VixlSettings>({
      version: 1,
      'providers.openrouter.apiKeyRef': 'openrouter',
    })
    useProviderModelsCatalog({ settings })

    await vi.waitFor(() => {
      expect(updateSetting).toHaveBeenCalledWith(
        'personal',
        'models.catalogMeta',
        {
          'openrouter::moonshotai/kimi-k3': {
            pricing: { inputPerMillion: 1, outputPerMillion: 2 },
            fastPricing: { inputPerMillion: 3, outputPerMillion: 4 },
          },
        },
      )
    })
  })

  it('toasts and clears groups when listing models fails', async () => {
    listAllProviderModels.mockRejectedValue(new Error('catalog down'))
    const { default: useProviderModelsCatalog } = await import(
      '@/composables/use-provider-models-catalog'
    )
    const settings = ref<VixlSettings>({
      version: 1,
      'providers.openai.apiKeyRef': 'openai',
    })
    const { groups, loading } = useProviderModelsCatalog({ settings })

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to load models', {
        description: 'catalog down',
      })
    })

    expect(groups.value).toEqual([])
    expect(loading.value).toBe(false)
  })
})
