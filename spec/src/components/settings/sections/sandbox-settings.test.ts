import { describe, expect, it } from 'vitest'
import {
  SANDBOX_ENABLED_DEFAULT,
  SANDBOX_NETWORK_DEFAULT,
  sandboxEnabledFromSettings,
  sandboxNetworkFromSettings,
} from '@/components/settings/sections/sandbox-settings'

describe('sandbox-settings', () => {
  it('defaults sandbox on and network deny', () => {
    expect(SANDBOX_ENABLED_DEFAULT).toBe(true)
    expect(SANDBOX_NETWORK_DEFAULT).toBe('deny')
    expect(sandboxEnabledFromSettings({ version: 1 })).toBe(true)
    expect(sandboxNetworkFromSettings({ version: 1 })).toBe('deny')
  })

  it('reads stored sandbox values', () => {
    expect(
      sandboxEnabledFromSettings({ version: 1, 'agent.sandbox.enabled': false }),
    ).toBe(false)
    expect(
      sandboxNetworkFromSettings({ version: 1, 'agent.sandbox.network': 'allow' }),
    ).toBe('allow')
  })
})
