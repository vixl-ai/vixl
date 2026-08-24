import { describe, expect, it } from 'vitest'
import resolveReasoningCapability from '@/services/models/resolve-reasoning-capability'
import {
  mapReasoningToCallOptions,
  pickResolvedReasoning,
  resolveReasoningForRole,
} from '@/services/models/resolve-reasoning-for-call'
import { resolveModelCallOptions } from '@/services/models/resolve-model-call-options'
import clampModelCatalogOption from '@/services/models/clamp-model-catalog-option'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const baseSettings = {
  version: 1,
  'models.default': 'anthropic::claude-sonnet-4-5',
  'models.agent': 'openai::gpt-4o',
  'models.subagent': 'google::gemini-2.0-flash',
  'models.defaultReasoning': 'low',
  'models.agentReasoning': 'high',
} as VixlSettings

describe('resolveReasoningCapability', () => {
  it('supports native anthropic models with family effort subsets', () => {
    const capability = resolveReasoningCapability(baseSettings, {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    })
    expect(capability.supported).toBe(true)
    expect(capability.levels).toEqual([
      'provider-default',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  it('hides effort for anthropic models outside effort families', () => {
    const capability = resolveReasoningCapability(baseSettings, {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    })
    expect(capability.supported).toBe(false)
    expect(capability.levels).toEqual([])
  })

  it('uses live ModelRef effort metadata when present', () => {
    const capability = resolveReasoningCapability(baseSettings, {
      providerId: 'openrouter',
      modelId: 'openai/gpt-5',
      supportsReasoningEffort: ['low', 'high'],
      reasoningMandatory: true,
    })
    expect(capability.supported).toBe(true)
    expect(capability.mandatory).toBe(true)
    expect(capability.levels).toEqual(['provider-default', 'low', 'high'])
  })

  it('prepends provider-default for live OpenRouter effort subsets', () => {
    const capability = resolveReasoningCapability(baseSettings, {
      providerId: 'openrouter',
      modelId: 'openai/gpt-oss',
      supportsReasoningEffort: ['low', 'medium', 'high'],
    })
    expect(capability.supported).toBe(true)
    expect(capability.levels).toEqual([
      'provider-default',
      'low',
      'medium',
      'high',
    ])
  })

  it('excludes none from levels when reasoning is mandatory', () => {
    const capability = resolveReasoningCapability(baseSettings, {
      providerId: 'openrouter',
      modelId: 'openai/o3-pro',
      supportsReasoningEffort: ['none', 'low', 'high'],
      reasoningMandatory: true,
    })
    expect(capability.supported).toBe(true)
    expect(capability.mandatory).toBe(true)
    expect(capability.levels).toEqual(['provider-default', 'low', 'high'])
    expect(capability.levels).not.toContain('none')
  })

  it('returns unsupported for non-reasoning OpenRouter models without live metadata', () => {
    const capability = resolveReasoningCapability(baseSettings, {
      providerId: 'openrouter',
      modelId: 'acme/unknown-chat',
    })
    expect(capability.supported).toBe(false)
    expect(capability.levels).toEqual([])
  })

  it('falls back to family rules for gateway ids without live levels', () => {
    const capability = resolveReasoningCapability(baseSettings, {
      providerId: 'gateway',
      modelId: 'openai/gpt-5.2',
    })
    expect(capability.supported).toBe(true)
    expect(capability.levels).toEqual([
      'provider-default',
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  it('hides effort for custom models without supportsReasoningEffort', () => {
    const settings = {
      ...baseSettings,
      'providers.custom.local': {
        type: 'openai-compatible',
        name: 'Local',
        baseURL: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'llama' }],
      },
    } as VixlSettings
    const capability = resolveReasoningCapability(settings, {
      providerId: 'local',
      modelId: 'llama',
    })
    expect(capability.supported).toBe(false)
  })

  it('hides effort when custom model only has thinking enabled', () => {
    const settings = {
      ...baseSettings,
      'providers.custom.local': {
        type: 'openai-compatible',
        name: 'Local',
        baseURL: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'qwen', thinking: true }],
      },
    } as VixlSettings
    const capability = resolveReasoningCapability(settings, {
      providerId: 'local',
      modelId: 'qwen',
    })
    expect(capability.supported).toBe(false)
  })

  it('shows effort when custom model lists supportsReasoningEffort', () => {
    const settings = {
      ...baseSettings,
      'providers.custom.local': {
        type: 'openai-compatible',
        name: 'Local',
        baseURL: 'http://127.0.0.1:11434/v1',
        models: [{
          id: 'qwen',
          thinking: true,
          supportsReasoningEffort: ['low', 'high'],
        }],
      },
    } as VixlSettings
    const capability = resolveReasoningCapability(settings, {
      providerId: 'local',
      modelId: 'qwen',
    })
    expect(capability.supported).toBe(true)
    expect(capability.levels).toEqual(['provider-default', 'low', 'high'])
  })
})

describe('clampModelCatalogOption', () => {
  it('clears stale xhigh and fast for unsupported models', () => {
    const settings = {
      ...baseSettings,
      'models.catalogOptions': {
        'anthropic::claude-sonnet-4-5': {
          reasoning: 'xhigh',
          fast: true,
        },
      },
    } as VixlSettings
    const ref = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    }
    const clamped = clampModelCatalogOption(settings, ref, {
      reasoning: 'xhigh',
      fast: true,
    })
    expect(clamped.reasoning).toBeUndefined()
    expect(clamped.fast).toBeUndefined()
  })
})

describe('resolveReasoningForRole / pickResolvedReasoning', () => {
  it('prefers role reasoning over default', () => {
    expect(resolveReasoningForRole('agent', baseSettings)).toBe('high')
    expect(resolveReasoningForRole('ask', baseSettings)).toBe('low')
  })

  it('picks first valid candidate', () => {
    expect(pickResolvedReasoning(['nope', 'medium', 'high'])).toBe('medium')
  })
})

describe('mapReasoningToCallOptions', () => {
  it('uses top-level reasoning for anthropic', () => {
    const mapped = mapReasoningToCallOptions(
      baseSettings,
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
      'high',
    )
    expect(mapped.reasoning).toBe('high')
    expect(mapped.providerOptionsKey).toBeUndefined()
  })

  it('maps catalog openai-compatible routers to openai providerOptions', () => {
    const mapped = mapReasoningToCallOptions(
      baseSettings,
      { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4-6' },
      'low',
    )
    expect(mapped.providerOptionsKey).toBe('openai')
    expect(mapped.providerOptionsReasoningEffort).toBe('low')
  })

  it('omits unsupported resolved effort at call time', () => {
    const mapped = mapReasoningToCallOptions(
      baseSettings,
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
      'high',
    )
    expect(mapped.reasoning).toBeUndefined()
    expect(mapped.providerOptionsReasoningEffort).toBeUndefined()
  })

  it('maps Anthropic max to top-level xhigh', () => {
    const mapped = mapReasoningToCallOptions(
      baseSettings,
      { providerId: 'anthropic', modelId: 'claude-opus-4-8' },
      'max',
    )
    expect(mapped.reasoning).toBe('xhigh')
    expect(mapped.providerOptionsReasoningEffort).toBeUndefined()
  })

  it('keeps OpenAI providerOptions reasoningEffort as max', () => {
    const mapped = mapReasoningToCallOptions(
      baseSettings,
      { providerId: 'openai', modelId: 'gpt-5.6' },
      'max',
    )
    expect(mapped.reasoning).toBe('xhigh')
    expect(mapped.providerOptionsKey).toBe('openai')
    expect(mapped.providerOptionsReasoningEffort).toBe('max')
  })
})

describe('resolveModelCallOptions with reasoning', () => {
  it('includes top-level reasoning for gateway', () => {
    const options = resolveModelCallOptions(
      baseSettings,
      { providerId: 'gateway', modelId: 'openai/gpt-5' },
      { reasoning: 'medium' },
    )
    expect(options.reasoning).toBe('medium')
  })

  it('maps OpenAI max through resolveModelCallOptions', () => {
    const options = resolveModelCallOptions(
      baseSettings,
      { providerId: 'openai', modelId: 'gpt-5.6' },
      { reasoning: 'max' },
    )
    expect(options.reasoning).toBe('xhigh')
    expect(options.providerOptions?.openai).toEqual({
      reasoningEffort: 'max',
    })
  })
})

describe('resolveModelForRole subagent', () => {
  it('uses models.subagent before agent fallback', () => {
    expect(resolveModelForRole('subagent', baseSettings)).toBe(
      'google::gemini-2.0-flash',
    )
  })

  it('falls back to agent then default', () => {
    const settings = {
      version: 1,
      'models.default': 'anthropic::claude-sonnet-4-5',
      'models.agent': 'openai::gpt-4o',
    } as VixlSettings
    expect(resolveModelForRole('subagent', settings)).toBe('openai::gpt-4o')
  })
})
