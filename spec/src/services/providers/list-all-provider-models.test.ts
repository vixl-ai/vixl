import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const { httpProxyRequest, getSecret } = vi.hoisted(() => ({
  httpProxyRequest: vi.fn<
    (request: { url: string; method: string; headers: Record<string, string> }) => Promise<{
      status: number
      body: string
    }>
  >(),
  getSecret: vi.fn<(key: string) => Promise<string | null>>(async () => 'test-key'),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    httpProxyRequest,
    getSecret,
  }),
)

import listAllProviderModels from '@/services/providers/list-all-provider-models'

describe('listAllProviderModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSecret.mockResolvedValue('test-key')
  })

  it('uses configured custom models when live listing fails', async () => {
    httpProxyRequest.mockRejectedValueOnce(new Error('live list unavailable'))

    const settings = {
      version: 1 as const,
      'providers.custom.kat': {
        type: 'openai-compatible' as const,
        name: 'Kat',
        baseURL: 'http://localhost:1234/v1',
        models: [
          { id: 'kat-coder-2.5', name: 'Kat Coder 2.5' },
          { id: 'kat-coder-lite' },
        ],
      },
    } satisfies VixlSettings

    const groups = await listAllProviderModels(settings)
    expect(httpProxyRequest).toHaveBeenCalled()
    expect(groups).toHaveLength(1)
    expect(groups[0]?.providerName).toBe('Kat')
    expect(groups[0]?.models).toEqual([
      { providerId: 'kat', modelId: 'kat-coder-2.5', name: 'Kat Coder 2.5' },
      { providerId: 'kat', modelId: 'kat-coder-lite' },
    ])
  })

  it('merges configured models ahead of live models', async () => {
    httpProxyRequest.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        data: [{ id: 'live-model' }, { id: 'kat-coder-2.5' }],
      }),
    })

    const settings = {
      version: 1 as const,
      'providers.custom.kat': {
        type: 'openai-compatible' as const,
        name: 'Kat',
        baseURL: 'http://localhost:1234/v1',
        models: [{ id: 'kat-coder-2.5', name: 'Configured' }],
      },
    } satisfies VixlSettings

    const groups = await listAllProviderModels(settings)
    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      'kat-coder-2.5',
      'live-model',
    ])
    expect(groups[0]?.models[0]?.name).toBe('Configured')
  })

  it('copies OpenRouter reasoning metadata onto ModelRef', async () => {
    httpProxyRequest.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        data: [
          {
            id: 'moonshotai/kimi-k3',
            reasoning: {
              supported_efforts: ['low', 'medium', 'high'],
              mandatory: true,
            },
          },
        ],
      }),
    })

    const settings = {
      version: 1 as const,
      'providers.openrouter.apiKeyRef': 'openrouter',
    } satisfies VixlSettings

    const groups = await listAllProviderModels(settings)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.providerId).toBe('openrouter')
    expect(groups[0]?.models).toEqual([
      {
        providerId: 'openrouter',
        modelId: 'moonshotai/kimi-k3',
        supportsReasoningEffort: ['low', 'medium', 'high'],
        reasoningMandatory: true,
      },
    ])
  })

  it('copies Gateway fast tag onto ModelRef without inventing effort levels', async () => {
    httpProxyRequest.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        data: [
          {
            id: 'anthropic/claude-opus-5',
            tags: ['reasoning', 'fast'],
          },
        ],
      }),
    })

    const settings = {
      version: 1 as const,
      'providers.gateway.apiKeyRef': 'gateway',
    } satisfies VixlSettings

    const groups = await listAllProviderModels(settings)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.providerId).toBe('gateway')
    expect(groups[0]?.models).toEqual([
      {
        providerId: 'gateway',
        modelId: 'anthropic/claude-opus-5',
        supportsFast: true,
      },
    ])
    expect(groups[0]?.models[0]?.supportsReasoningEffort).toBeUndefined()
  })

  it('leaves supportsReasoningEffort undefined for non-reasoning OpenRouter models', async () => {
    httpProxyRequest.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        data: [{ id: 'openai/gpt-4o' }],
      }),
    })

    const settings = {
      version: 1 as const,
      'providers.openrouter.apiKeyRef': 'openrouter',
    } satisfies VixlSettings

    const groups = await listAllProviderModels(settings)
    expect(groups[0]?.models).toEqual([
      {
        providerId: 'openrouter',
        modelId: 'openai/gpt-4o',
      },
    ])
    expect(groups[0]?.models[0]?.supportsReasoningEffort).toBeUndefined()
    expect(groups[0]?.models[0]?.reasoningMandatory).toBeUndefined()
  })
})
