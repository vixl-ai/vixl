import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { LanguageModelV3 } from '@ai-sdk/provider'

const createModel = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<LanguageModelV3>>(),
)
const resolveModelVision = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<boolean>>(),
)

vi.mock('@/services/providers/create-model', () => ({
  default: createModel,
}))

vi.mock('@/services/harness/resolve-model-vision', () => ({
  default: resolveModelVision,
}))

import resolveSelectedModelVision from '@/services/harness/resolve-selected-model-vision'

const stubModel = (): LanguageModelV3 =>
  ({
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('not implemented')
    },
    doStream: async () => {
      throw new Error('not implemented')
    },
  }) as LanguageModelV3

const settings = (): VixlSettings => ({ version: 1 })

describe('resolveSelectedModelVision', () => {
  beforeEach(() => {
    createModel.mockReset()
    resolveModelVision.mockReset()
  })

  it('returns true when model ref cannot be parsed', async () => {
    expect(
      await resolveSelectedModelVision({
        modelRef: 'not-a-ref',
        settings: settings(),
      }),
    ).toBe(true)
    expect(createModel).not.toHaveBeenCalled()
  })

  it('delegates to resolveModelVision when createModel succeeds', async () => {
    const model = stubModel()
    createModel.mockResolvedValue(model)
    resolveModelVision.mockResolvedValue(false)

    const result = await resolveSelectedModelVision({
      modelRef: 'anthropic::claude-sonnet-4-5',
      settings: settings(),
    })

    expect(result).toBe(false)
    expect(createModel).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      settings: settings(),
    })
    expect(resolveModelVision).toHaveBeenCalledWith({
      model,
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      settings: settings(),
    })
  })

  it('returns true when createModel fails', async () => {
    createModel.mockRejectedValue(new Error('keychain unavailable'))

    expect(
      await resolveSelectedModelVision({
        modelRef: 'openai::gpt-4o',
        settings: settings(),
      }),
    ).toBe(true)
    expect(resolveModelVision).not.toHaveBeenCalled()
  })

  it('returns true when resolveModelVision reports vision', async () => {
    createModel.mockResolvedValue(stubModel())
    resolveModelVision.mockResolvedValue(true)

    expect(
      await resolveSelectedModelVision({
        modelRef: 'anthropic::claude-sonnet-4-5',
        settings: settings(),
      }),
    ).toBe(true)
  })
})
