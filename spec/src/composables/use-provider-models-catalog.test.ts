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
  () => vi.fn<() => Promise<void>>(async () => undefined),
)

vi.mock('@/services/providers/list-all-provider-models', () => ({
  default: listAllProviderModels,
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

describe('use-provider-models-catalog', () => {
  beforeEach(() => {
    listAllProviderModels.mockReset()
    listAllProviderModels.mockResolvedValue(openaiListed())
    updateSetting.mockReset()
    updateSetting.mockResolvedValue(undefined)
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
})
