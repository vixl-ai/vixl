import { SANDBOX_NETWORK_DEFAULT } from '@/schemas/vixl-settings'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

export type SandboxNetwork = NonNullable<VixlSettings['agent.sandbox.network']>

export const SANDBOX_ENABLED_DEFAULT = true
export { SANDBOX_NETWORK_DEFAULT }

export const sandboxEnabledFromSettings = (settings: VixlSettings): boolean =>
  settings['agent.sandbox.enabled'] ?? SANDBOX_ENABLED_DEFAULT

export const sandboxNetworkFromSettings = (settings: VixlSettings): SandboxNetwork =>
  settings['agent.sandbox.network'] ?? SANDBOX_NETWORK_DEFAULT
