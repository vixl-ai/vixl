import { describe, expect, it } from 'vitest'
import { buildModelSearchCapabilities } from '@/components/models/search/model-search-result-view'
import type { ReasoningCapability } from '@/services/models/resolve-reasoning-capability'

const reasoningSupported: ReasoningCapability = {
  supported: true,
  levels: ['provider-default', 'low', 'high', 'xhigh'],
  mandatory: false,
}

const reasoningUnsupported: ReasoningCapability = {
  supported: false,
  levels: [],
  mandatory: false,
}

describe('buildModelSearchCapabilities', () => {
  it('returns no icons when meta and capability are empty', () => {
    expect(
      buildModelSearchCapabilities({
        meta: {},
        option: {},
        capability: reasoningUnsupported,
        supportsFast: false,
      }),
    ).toEqual([])
  })

  it('includes vision and tools when meta flags are true', () => {
    expect(
      buildModelSearchCapabilities({
        meta: { vision: true, toolCalling: true },
        option: {},
        capability: reasoningUnsupported,
        supportsFast: false,
      }),
    ).toEqual([
      { key: 'vision', tooltip: 'Vision', muted: false },
      { key: 'tools', tooltip: 'Tools', muted: false },
    ])
  })

  it('shows a muted reasoning icon for provider-default', () => {
    expect(
      buildModelSearchCapabilities({
        meta: {},
        option: { reasoning: 'provider-default' },
        capability: reasoningSupported,
        supportsFast: false,
      }),
    ).toEqual([{ key: 'reasoning', tooltip: 'Reasoning', muted: true }])
  })

  it('labels an explicit reasoning level with the short id', () => {
    expect(
      buildModelSearchCapabilities({
        meta: {},
        option: { reasoning: 'xhigh' },
        capability: reasoningSupported,
        supportsFast: false,
      }),
    ).toEqual([
      {
        key: 'reasoning',
        tooltip: 'Reasoning: xhigh',
        muted: false,
        label: 'xhigh',
      },
    ])
  })

  it('omits reasoning when the capability is unsupported', () => {
    expect(
      buildModelSearchCapabilities({
        meta: {},
        option: { reasoning: 'high' },
        capability: reasoningUnsupported,
        supportsFast: false,
      }),
    ).toEqual([])
  })

  it('highlights fast when option.fast is on', () => {
    expect(
      buildModelSearchCapabilities({
        meta: {},
        option: { fast: true },
        capability: reasoningUnsupported,
        supportsFast: true,
      }),
    ).toEqual([{ key: 'fast', tooltip: 'Fast on', muted: false }])
  })

  it('mutes fast when it is available but off', () => {
    expect(
      buildModelSearchCapabilities({
        meta: {},
        option: {},
        capability: reasoningUnsupported,
        supportsFast: true,
      }),
    ).toEqual([{ key: 'fast', tooltip: 'Fast available', muted: true }])
  })
})
