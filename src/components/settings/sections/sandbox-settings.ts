import type { PyrolaSettings } from '@/types/pyrola/pyrola-settings'

export type SandboxNetwork = NonNullable<PyrolaSettings['agent.sandbox.network']>

export const SANDBOX_ENABLED_DEFAULT = true
export const SANDBOX_NETWORK_DEFAULT: SandboxNetwork = 'deny'

export const sandboxEnabledFromSettings = (settings: PyrolaSettings): boolean =>
  settings['agent.sandbox.enabled'] ?? SANDBOX_ENABLED_DEFAULT

export const sandboxNetworkFromSettings = (settings: PyrolaSettings): SandboxNetwork =>
  settings['agent.sandbox.network'] ?? SANDBOX_NETWORK_DEFAULT
