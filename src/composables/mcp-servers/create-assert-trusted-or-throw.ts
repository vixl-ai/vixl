import type { McpServerConfig } from '@/types/vixl/mcp-config'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'
import useVixlConfig from '@/composables/use-vixl-config'

const createAssertTrustedOrThrow = (
  config: ReturnType<typeof useVixlConfig>,
) => (
  serverId: string,
  serverConfig: McpServerConfig,
  settings?: VixlSettings,
  scopeKey?: string | null,
): void => {
  if (isInternalMcpServer(serverId)) {
    return
  }
  const fingerprint = mcpServerFingerprint(serverConfig)
  if (
    !isMcpTrusted(
      settings ?? config.effectiveSettings.value,
      serverId,
      fingerprint,
      sessionTrusts,
      scopeKey,
    )
  ) {
    throw new Error(
      `MCP server "${serverId}" is not trusted for the current configuration`,
    )
  }
}

export default createAssertTrustedOrThrow
