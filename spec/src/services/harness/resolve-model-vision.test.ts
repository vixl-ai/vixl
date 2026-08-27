import { describe, expect, it } from 'vitest'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { LanguageModelV3 } from '@ai-sdk/provider'

const baseSettings = (): VixlSettings => ({
  version: 1,
})

const stubModel = (supportedUrls: Record<string, RegExp[]>): LanguageModelV3 =>
  ({
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls,
    doGenerate: async () => {
      throw new Error('not implemented')
    },
    doStream: async () => {
      throw new Error('not implemented')
    },
  }) as LanguageModelV3

describe('resolveModelVision', () => {
  it('trusts custom model vision flag when true', async () => {
    const settings: VixlSettings = {
      ...baseSettings(),
      'providers.custom.local': {
        type: 'openai-compatible',
        baseURL: 'http://localhost:11434/v1',
        name: 'Local',
        models: [{ id: 'llava', vision: true }],
      },
    }
    expect(
      await resolveModelVision({
        model: stubModel({}),
        providerId: 'local',
        modelId: 'llava',
        settings,
      }),
    ).toBe(true)
  })

  it('treats custom model without vision as text-only even if supportedUrls has images', async () => {
    const settings: VixlSettings = {
      ...baseSettings(),
      'providers.custom.local': {
        type: 'openai-compatible',
        baseURL: 'http://localhost:11434/v1',
        name: 'Local',
        models: [{ id: 'llama3' }],
      },
    }
    expect(
      await resolveModelVision({
        model: stubModel({ 'image/*': [/^https?:\/\//] }),
        providerId: 'local',
        modelId: 'llama3',
        settings,
      }),
    ).toBe(false)
  })

  it('uses LanguageModel.supportedUrls for built-in providers', async () => {
    expect(
      await resolveModelVision({
        model: stubModel({ 'image/*': [/^https?:\/\//] }),
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        settings: baseSettings(),
      }),
    ).toBe(true)

    expect(
      await resolveModelVision({
        model: stubModel({}),
        providerId: 'anthropic',
        modelId: 'some-model',
        settings: baseSettings(),
      }),
    ).toBe(false)
  })

  it('falls back to catalogMeta.vision when SDK does not advertise images', async () => {
    expect(
      await resolveModelVision({
        model: stubModel({}),
        providerId: 'openai',
        modelId: 'gpt-4o',
        settings: {
          ...baseSettings(),
          'models.catalogMeta': {
            'openai::gpt-4o': { vision: true },
          },
        },
      }),
    ).toBe(true)
  })
})
