import { describe, expect, it } from 'vitest'
import {
  createEmptyModel,
  createEmptyPricing,
  draftToModel,
  draftToPricing,
  modelHasPricingConfigured,
  modelToDraft,
  parseOptionalNumber,
} from '@/composables/manage-provider-dialog/draft-helpers'
import mergeCatalogMetaFromCustomProviders from '@/services/models/merge-catalog-meta-from-custom'
import resolveReasoningCapability from '@/services/models/resolve-reasoning-capability'
import type {
  VixlCustomProviderModel,
  VixlSettings,
} from '@/types/vixl/vixl-settings'

const fullCustomModel = (): VixlCustomProviderModel => ({
  id: 'qwen3',
  name: 'Qwen 3',
  vision: true,
  toolCalling: true,
  thinking: true,
  streaming: true,
  pricing: {
    inputPerMillion: 1,
    outputPerMillion: 2,
    cacheReadPerMillion: 0.1,
  },
  fastPricing: {
    inputPerMillion: 3,
    outputPerMillion: 4,
    reasoningPerMillion: 5,
  },
  contextWindow: 64000,
  maxOutputTokens: 8192,
  supportsReasoningEffort: ['low', 'high'],
})

const settingsWithCustomModel = (model: VixlCustomProviderModel): VixlSettings => ({
  version: 1,
  'providers.custom.local': {
    type: 'openai-compatible',
    name: 'Local',
    baseURL: 'http://127.0.0.1:11434/v1',
    models: [model],
  },
})

describe('draftToPricing', () => {
  it('returns rates when input and output are numbers', () => {
    expect(
      draftToPricing({
        ...createEmptyPricing(),
        inputPerMillion: 3,
        outputPerMillion: 15,
      }),
    ).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
    })
  })

  it('returns undefined for empty strings', () => {
    expect(draftToPricing(createEmptyPricing())).toBeUndefined()
  })

  it('treats 0 as valid pricing', () => {
    expect(
      draftToPricing({
        ...createEmptyPricing(),
        inputPerMillion: 0,
        outputPerMillion: 0,
      }),
    ).toEqual({
      inputPerMillion: 0,
      outputPerMillion: 0,
    })
  })
})

describe('modelHasPricingConfigured', () => {
  it('is true when pricing values are numbers', () => {
    const draft = createEmptyModel()
    draft.pricing.inputPerMillion = 3
    draft.pricing.outputPerMillion = 15
    expect(modelHasPricingConfigured(draft)).toBe(true)
  })

  it('is true when a pricing value is 0', () => {
    const draft = createEmptyModel()
    draft.pricing.inputPerMillion = 0
    expect(modelHasPricingConfigured(draft)).toBe(true)
  })

  it('is true when only fastPricing is set', () => {
    const draft = createEmptyModel()
    draft.fastPricing.inputPerMillion = 3
    draft.fastPricing.outputPerMillion = 4
    expect(modelHasPricingConfigured(draft)).toBe(true)
  })
})

describe('parseOptionalNumber', () => {
  it('parses numeric and string values', () => {
    expect(parseOptionalNumber(15)).toBe(15)
    expect(parseOptionalNumber('15')).toBe(15)
  })
})

describe('custom model dialog save round-trip', () => {
  it('preserves full metadata including fastPricing', () => {
    const original = fullCustomModel()
    const saved = draftToModel(modelToDraft(original))

    expect(saved).toMatchObject({
      id: 'qwen3',
      name: 'Qwen 3',
      vision: true,
      toolCalling: true,
      contextWindow: 64000,
      maxOutputTokens: 8192,
      supportsReasoningEffort: ['low', 'high'],
      pricing: {
        inputPerMillion: 1,
        outputPerMillion: 2,
        cacheReadPerMillion: 0.1,
      },
      fastPricing: {
        inputPerMillion: 3,
        outputPerMillion: 4,
        reasoningPerMillion: 5,
      },
    })
  })

  it('lands full metadata in catalogMeta after a save round-trip', () => {
    const saved = draftToModel(modelToDraft(fullCustomModel()))
    const next = mergeCatalogMetaFromCustomProviders(settingsWithCustomModel(saved), {})

    expect(next['local::qwen3']).toEqual({
      contextWindow: 64000,
      maxOutputTokens: 8192,
      pricing: {
        inputPerMillion: 1,
        outputPerMillion: 2,
        cacheReadPerMillion: 0.1,
      },
      fastPricing: {
        inputPerMillion: 3,
        outputPerMillion: 4,
        reasoningPerMillion: 5,
      },
      vision: true,
      toolCalling: true,
    })
  })

  it('keeps supportsReasoningEffort available to the picker after save', () => {
    const saved = draftToModel(modelToDraft(fullCustomModel()))
    const capability = resolveReasoningCapability(settingsWithCustomModel(saved), {
      providerId: 'local',
      modelId: 'qwen3',
    })

    expect(capability.supported).toBe(true)
    expect(capability.levels).toEqual(['provider-default', 'low', 'high'])
  })

  it('omits pricing and fastPricing when both drafts are empty', () => {
    const saved = draftToModel({
      ...createEmptyModel(),
      id: 'plain',
    })

    expect(saved.pricing).toBeUndefined()
    expect(saved.fastPricing).toBeUndefined()
  })

  it('produces no catalogMeta patch for a custom model with no metadata', () => {
    const next = mergeCatalogMetaFromCustomProviders(
      settingsWithCustomModel({ id: 'plain' }),
      {},
    )

    expect(next).toEqual({})
    expect(next['local::plain']).toBeUndefined()
  })
})
