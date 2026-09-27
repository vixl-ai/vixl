import { describe, expect, it } from 'vitest'
import pickCapabilityDefaultLevel from '@/services/models/pick-capability-default-level'
import resolveBuiltinReasoningCapability from '@/services/models/resolve-builtin-model-capabilities'

describe('pickCapabilityDefaultLevel', () => {
  it('uses a preferred level when it is in the list', () => {
    expect(
      pickCapabilityDefaultLevel(['provider-default', 'low', 'medium', 'high'], 'high'),
    ).toBe('high')
  })

  it('falls back to medium when preferred is missing from the list', () => {
    expect(
      pickCapabilityDefaultLevel(['provider-default', 'low', 'medium', 'high'], 'none'),
    ).toBe('medium')
  })

  it('skips none and provider-default when medium is absent', () => {
    expect(
      pickCapabilityDefaultLevel(['provider-default', 'none', 'low', 'high']),
    ).toBe('low')
  })

  it('uses the first concrete level when only none remains', () => {
    expect(pickCapabilityDefaultLevel(['provider-default', 'none'])).toBe('none')
  })
})

describe('resolveBuiltinReasoningCapability', () => {
  it('resolves OpenAI gpt-5.1 effort subset with none as default', () => {
    expect(
      resolveBuiltinReasoningCapability({
        providerId: 'openai',
        modelId: 'gpt-5.1',
      }),
    ).toEqual({
      supported: true,
      levels: ['provider-default', 'none', 'low', 'medium', 'high'],
      mandatory: false,
      defaultLevel: 'none',
    })
  })

  it('resolves OpenAI gpt-5.2 effort subset including xhigh', () => {
    expect(
      resolveBuiltinReasoningCapability({
        providerId: 'openai',
        modelId: 'gpt-5.2',
      }),
    ).toEqual({
      supported: true,
      levels: ['provider-default', 'none', 'low', 'medium', 'high', 'xhigh'],
      mandatory: false,
      defaultLevel: 'none',
    })
  })

  it('resolves OpenAI gpt-5-pro as mandatory high only', () => {
    expect(
      resolveBuiltinReasoningCapability({
        providerId: 'openai',
        modelId: 'gpt-5-pro',
      }),
    ).toEqual({
      supported: true,
      levels: ['high'],
      mandatory: true,
      defaultLevel: 'high',
    })
  })

  it('resolves OpenAI gpt-5 with medium as the documented default', () => {
    expect(
      resolveBuiltinReasoningCapability({
        providerId: 'openai',
        modelId: 'gpt-5',
      }),
    ).toEqual({
      supported: true,
      levels: ['provider-default', 'minimal', 'low', 'medium', 'high'],
      mandatory: false,
      defaultLevel: 'medium',
    })
  })

  it('resolves Anthropic Opus 4-6 with xhigh but not max', () => {
    expect(
      resolveBuiltinReasoningCapability({
        providerId: 'anthropic',
        modelId: 'claude-opus-4-6',
      }),
    ).toEqual({
      supported: true,
      levels: ['provider-default', 'low', 'medium', 'high', 'xhigh'],
      mandatory: false,
      defaultLevel: 'high',
    })
  })

  it('resolves Anthropic Opus 4-8 with max', () => {
    expect(
      resolveBuiltinReasoningCapability({
        providerId: 'anthropic',
        modelId: 'claude-opus-4-8',
      }),
    ).toEqual({
      supported: true,
      levels: ['provider-default', 'low', 'medium', 'high', 'xhigh', 'max'],
      mandatory: false,
      defaultLevel: 'high',
    })
  })

  it('resolves Google gemini-3.5-flash effort subset', () => {
    expect(
      resolveBuiltinReasoningCapability({
        providerId: 'google',
        modelId: 'gemini-3.5-flash',
      }),
    ).toEqual({
      supported: true,
      levels: ['provider-default', 'minimal', 'low', 'medium', 'high'],
      mandatory: false,
      defaultLevel: 'high',
    })
  })

  it('reuses Anthropic family rules for Gateway anthropic/ ids', () => {
    expect(
      resolveBuiltinReasoningCapability({
        providerId: 'gateway',
        modelId: 'anthropic/claude-opus-5',
      }),
    ).toEqual({
      supported: true,
      levels: ['provider-default', 'low', 'medium', 'high', 'xhigh', 'max'],
      mandatory: false,
      defaultLevel: 'high',
    })
  })

  it('reuses OpenAI family rules for OpenRouter openai/ ids', () => {
    expect(
      resolveBuiltinReasoningCapability({
        providerId: 'openrouter',
        modelId: 'openai/gpt-5.2',
      }),
    ).toEqual({
      supported: true,
      levels: ['provider-default', 'none', 'low', 'medium', 'high', 'xhigh'],
      mandatory: false,
      defaultLevel: 'none',
    })
  })
})
