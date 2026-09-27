import { beforeEach, describe, expect, it, vi } from 'vitest'

const proxyFetchImpl = vi.hoisted(() =>
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
)

vi.mock('@/services/providers/proxy-fetch', () => ({
  default: () => proxyFetchImpl,
}))

import resolveModelsDevVision from '@/services/models/models-dev/vision'

const catalogResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const catalog = {
  openai: {
    models: {
      'gpt-5.6-sol': { modalities: { input: ['text', 'image'] } },
      'gpt-3.5-turbo': { modalities: { input: ['text'] } },
    },
  },
  vercel: {
    npm: '@ai-sdk/gateway',
    models: {
      'openai/gpt-5.6-sol': {
        modalities: { input: ['text', 'image', 'pdf'] },
      },
    },
  },
  openrouter: {
    models: {
      'openai/gpt-5.6-sol': {
        modalities: { input: ['text', 'image', 'pdf'] },
      },
      'openai/gpt-3.5-turbo': { modalities: { input: ['text'] } },
    },
  },
}

describe('resolveModelsDevVision', () => {
  beforeEach(() => {
    proxyFetchImpl.mockReset()
    proxyFetchImpl.mockImplementation(async () => catalogResponse(catalog))
  })

  it('returns true when modalities.input includes image', async () => {
    expect(
      await resolveModelsDevVision({
        providerId: 'openai',
        modelId: 'gpt-5.6-sol',
      }),
    ).toBe(true)
    expect(proxyFetchImpl).toHaveBeenCalledWith('https://models.dev/api.json')
  })

  it('returns false when the model is text-only', async () => {
    expect(
      await resolveModelsDevVision({
        providerId: 'openai',
        modelId: 'gpt-3.5-turbo',
      }),
    ).toBe(false)
  })

  it('looks up gateway full ids via package match on the vercel catalog key', async () => {
    expect(
      await resolveModelsDevVision({
        providerId: 'gateway',
        modelId: 'openai/gpt-5.6-sol',
      }),
    ).toBe(true)
    expect(
      await resolveModelsDevVision({
        providerId: 'gateway',
        modelId: 'gpt-5.6-sol',
      }),
    ).toBeUndefined()
  })

  it('does not attach vercel catalog rows to the v0 vercel provider', async () => {
    expect(
      await resolveModelsDevVision({
        providerId: 'vercel',
        modelId: 'openai/gpt-5.6-sol',
      }),
    ).toBeUndefined()
  })

  it('looks up openrouter full ids without splitting', async () => {
    expect(
      await resolveModelsDevVision({
        providerId: 'openrouter',
        modelId: 'openai/gpt-5.6-sol',
      }),
    ).toBe(true)
    expect(
      await resolveModelsDevVision({
        providerId: 'openrouter',
        modelId: 'openai/gpt-3.5-turbo',
      }),
    ).toBe(false)
    expect(
      await resolveModelsDevVision({
        providerId: 'openrouter',
        modelId: 'gpt-5.6-sol',
      }),
    ).toBeUndefined()
  })

  it('returns undefined for an unknown model', async () => {
    expect(
      await resolveModelsDevVision({
        providerId: 'openai',
        modelId: 'not-a-real-model',
      }),
    ).toBeUndefined()
  })

  it('returns undefined for an unknown provider', async () => {
    expect(
      await resolveModelsDevVision({
        providerId: 'acme',
        modelId: 'gpt-5.6-sol',
      }),
    ).toBeUndefined()
  })

  it('returns undefined when fetch fails', async () => {
    proxyFetchImpl.mockRejectedValue(new Error('network down'))
    expect(
      await resolveModelsDevVision({
        providerId: 'openai',
        modelId: 'gpt-5.6-sol',
      }),
    ).toBeUndefined()
  })

  it('returns undefined when the payload is invalid', async () => {
    proxyFetchImpl.mockResolvedValue(catalogResponse(['not-a-catalog']))
    expect(
      await resolveModelsDevVision({
        providerId: 'openai',
        modelId: 'gpt-5.6-sol',
      }),
    ).toBeUndefined()
  })
})
