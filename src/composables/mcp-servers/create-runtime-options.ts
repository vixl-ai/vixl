import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { McpRuntimeOptions } from '@/services/mcp/mcp-runtime'
import useVixlConfig from '@/composables/use-vixl-config'

const createRuntimeOptions = (
  config: ReturnType<typeof useVixlConfig>,
) => (
  extras?: Pick<
    McpRuntimeOptions,
    | 'confirmAuthorizationServerOrigin'
    | 'skipTrustCheck'
    | 'scope'
    | 'scopeKey'
    | 'resourceMetadataUrl'
    | 'settings'
  >,
): McpRuntimeOptions => ({
  settings: config.effectiveSettings.value as VixlSettings,
  ...extras,
})

export default createRuntimeOptions
