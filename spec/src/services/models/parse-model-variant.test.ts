import { describe, expect, it } from 'vitest'
import {
  collapseModelVariants,
  parseModelVariant,
  preferredFastSiblingId,
} from '@/services/models/parse-model-variant'
import resolveModelRefForCall, {
  canonicalizeModelRef,
} from '@/services/models/resolve-model-ref-for-call'
import { resolveModelCallOptions } from '@/services/models/resolve-model-call-options'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

describe('parseModelVariant', () => {
  it('detects -fast siblings', () => {
    expect(parseModelVariant('moonshotai/kimi-k3-fast')).toEqual({
      modelId: 'moonshotai/kimi-k3-fast',
      baseModelId: 'moonshotai/kimi-k3',
      kind: 'fast',
      displayKey: 'kimi-k3',
    })
  })

  it('detects -highspeed siblings', () => {
    expect(parseModelVariant('moonshotai/kimi-k2.7-code-highspeed').kind).toBe(
      'fast',
    )
  })
})

describe('collapseModelVariants', () => {
  it('hides -fast when base exists and marks supportsFast', () => {
    const collapsed = collapseModelVariants([
      { providerId: 'gateway', modelId: 'moonshotai/kimi-k3' },
      { providerId: 'gateway', modelId: 'moonshotai/kimi-k3-fast' },
      { providerId: 'gateway', modelId: 'moonshotai/kimi-latest' },
    ])
    expect(collapsed.map((model) => model.modelId)).toEqual([
      'moonshotai/kimi-k3',
      'moonshotai/kimi-latest',
    ])
    expect(collapsed[0]?.supportsFast).toBe(true)
    expect(collapsed[0]?.fastModelId).toBe('moonshotai/kimi-k3-fast')
    expect(collapsed[1]?.supportsFast).toBeFalsy()
  })

  it('keeps preferred fast sibling id', () => {
    expect(
      preferredFastSiblingId('moonshotai/kimi-k3', [
        'moonshotai/kimi-k3-fast',
        'moonshotai/kimi-k3-highspeed',
      ]),
    ).toBe('moonshotai/kimi-k3-fast')
  })
})

describe('resolveModelRefForCall', () => {
  it('keeps gateway base id and marks fast for providerOptions', () => {
    const settings = {
      version: 1,
      'models.catalogOptions': {
        'gateway::moonshotai/kimi-k3': { fast: true },
      },
    } as VixlSettings
    const resolved = resolveModelRefForCall(settings, {
      providerId: 'gateway',
      modelId: 'moonshotai/kimi-k3',
      supportsFast: true,
      fastModelId: 'moonshotai/kimi-k3-fast',
    })
    expect(resolved.createRef.modelId).toBe('moonshotai/kimi-k3')
    expect(resolved.fast).toBe(true)

    const options = resolveModelCallOptions(settings, resolved.optionRef)
    expect(options.providerOptions?.gateway).toEqual({ speed: 'fast' })
  })

  it('canonicalizes stored -fast gateway selections', () => {
    const canonical = canonicalizeModelRef({
      providerId: 'gateway',
      modelId: 'moonshotai/kimi-k3-fast',
    })
    expect(canonical.modelId).toBe('moonshotai/kimi-k3')
  })

  it('rewrites non-gateway models to -fast slug', () => {
    const settings = {
      version: 1,
      'models.catalogOptions': {
        'openrouter::moonshotai/kimi-k3': { fast: true },
      },
    } as VixlSettings
    const resolved = resolveModelRefForCall(settings, {
      providerId: 'openrouter',
      modelId: 'moonshotai/kimi-k3',
      supportsFast: true,
      fastModelId: 'moonshotai/kimi-k3-fast',
    })
    expect(resolved.createRef.modelId).toBe('moonshotai/kimi-k3-fast')
    expect(resolved.optionRef.modelId).toBe('moonshotai/kimi-k3')
  })
})
