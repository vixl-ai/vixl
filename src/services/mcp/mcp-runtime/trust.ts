import type { McpServerConfig } from '@/types/vixl/mcp-config'
import { mcpKnownSecretKeys } from '@/services/mcp/mcp-keychain-keys'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import { listRequiredInputIdsForServer } from '@/services/mcp/resolve-mcp-inputs'
import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'
import { deleteSecret } from '@/services/vixl/vixl-tauri'
import type { McpRuntimeOptions } from './types'

export const clearServerSecrets = async (
  serverId: string,
  config?: McpServerConfig,
): Promise<void> => {
  const inputIds = config ? listRequiredInputIdsForServer(config) : []
  for (const key of mcpKnownSecretKeys(serverId, inputIds)) {
    await deleteSecret(key)
  }
}

export const assertServerTrusted = (
  serverId: string,
  config: McpServerConfig,
  options?: McpRuntimeOptions,
): void => {
  if (options?.skipTrustCheck || isInternalMcpServer(serverId)) {
    return
  }
  const settings = options?.settings
  if (!settings) {
    throw new Error('MCP trust check requires settings')
  }
  const fingerprint = mcpServerFingerprint(config)
  if (!isMcpTrusted(settings, serverId, fingerprint, sessionTrusts)) {
    throw new Error(
      `MCP server "${serverId}" is not trusted for the current configuration`,
    )
  }
}
