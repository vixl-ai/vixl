import { describe, expect, it } from 'vitest'
import { resolveModelCallOptions } from '@/services/models/resolve-model-call-options'
import toCachedInstructions from '@/services/models/to-cached-instructions'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const settings = { version: 1 } as VixlSettings

const frozenSystem = 'Frozen system prefix. Mentions stay out of instructions.'

describe('resolveModelCallOptions prompt cache', () => {
  it('sets an Anthropic cache breakpoint on providerOptions', () => {
    const options = resolveModelCallOptions(settings, {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    })
    expect(options.providerOptions).toEqual({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    })
    expect(toCachedInstructions(frozenSystem, options.providerOptions)).toEqual({
      role: 'system',
      content: frozenSystem,
      providerOptions: {
        anthropic: {
          cacheControl: { type: 'ephemeral' },
        },
      },
    })
  })

  it('sets Anthropic cacheControl for gateway Claude slugs', () => {
    const options = resolveModelCallOptions(settings, {
      providerId: 'gateway',
      modelId: 'anthropic/claude-sonnet-4-5',
    })
    expect(options.providerOptions).toEqual({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    })
  })

  it('merges cacheControl with Anthropic fast speed', () => {
    const options = resolveModelCallOptions(
      {
        version: 1,
        'models.catalogOptions': {
          'anthropic::claude-opus-4-8': { fast: true },
        },
      } as VixlSettings,
      {
        providerId: 'anthropic',
        modelId: 'claude-opus-4-8',
        supportsFast: true,
      },
    )
    expect(options.providerOptions).toEqual({
      anthropic: {
        speed: 'fast',
        cacheControl: { type: 'ephemeral' },
      },
    })
  })

  it('does not add cacheControl for OpenAI', () => {
    const options = resolveModelCallOptions(settings, {
      providerId: 'openai',
      modelId: 'gpt-4o',
    })
    expect(options.providerOptions).toBeUndefined()
    expect(toCachedInstructions(frozenSystem, options.providerOptions)).toBe(
      frozenSystem,
    )
  })

  it('does not add cacheControl for Google', () => {
    const options = resolveModelCallOptions(settings, {
      providerId: 'google',
      modelId: 'gemini-2.0-flash',
    })
    expect(options.providerOptions).toBeUndefined()
    expect(toCachedInstructions(frozenSystem, options.providerOptions)).toBe(
      frozenSystem,
    )
  })

  it('does not add Anthropic cache for non-Claude gateway models', () => {
    const options = resolveModelCallOptions(settings, {
      providerId: 'gateway',
      modelId: 'openai/gpt-5',
    })
    expect(options.providerOptions?.anthropic).toBeUndefined()
  })
})
