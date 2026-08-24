import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const { listAllProviderModels } = vi.hoisted(() => ({
  listAllProviderModels: vi.fn<() => Promise<ProviderModelGroup[]>>(),
}))

vi.mock('@/services/providers/list-all-provider-models', () => ({
  default: listAllProviderModels,
}))

import loadProviderModelsCatalog from '@/services/models/catalog-cache'

const groups: ProviderModelGroup[] = [
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    models: [{ providerId: 'openai', modelId: 'gpt-4o' }],
  },
]

describe('loadProviderModelsCatalog', () => {
  beforeEach(() => {
    listAllProviderModels.mockReset()
    listAllProviderModels.mockResolvedValue(groups)
  })

  it('does not call listAllProviderModels twice for the same settings fingerprint', async () => {
    const settings = {
      version: 1,
      'providers.openai.apiKeyRef': `ref-${crypto.randomUUID()}`,
    } as VixlSettings

    const first = await loadProviderModelsCatalog(settings)
    const second = await loadProviderModelsCatalog(settings)

    expect(listAllProviderModels).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
  })
})
