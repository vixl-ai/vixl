import { migrateMcpConfig } from '@/schemas/mcp-config'
import { listEffectiveMcpServers } from '@/services/mcp/merge-mcp-config'
import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import { readMcpConfig } from '@/services/vixl/vixl-tauri'
import {
  buildCodegraphServer,
  isInternalMcpServer,
} from '@/types/codegraph/managed-codegraph'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const resolveTrustedMcpServer = async (
  ctx: HarnessToolContext,
  serverId: string,
): Promise<{
  trusted: boolean
  config?: import('@/types/vixl/mcp-config').McpServerConfig
}> => {
  // First-party CodeGraph is in-memory only (stripped from user mcp.json).
  if (isInternalMcpServer(serverId)) {
    return {
      trusted: true,
      config: buildCodegraphServer(ctx.projectRoot),
    }
  }

  const personal = migrateMcpConfig(await readMcpConfig('personal', null))
  const projectRaw = await readMcpConfig('project', ctx.projectRoot).catch(() => null)
  const project = projectRaw ? migrateMcpConfig(projectRaw) : null
  const server = listEffectiveMcpServers(personal, project).find((item) => item.id === serverId)
  if (!server) {
    return { trusted: false }
  }
  const fingerprint = mcpServerFingerprint(server.config)
  return {
    trusted: isMcpTrusted(ctx.settings, serverId, fingerprint, sessionTrusts),
    config: server.config,
  }
}

export default resolveTrustedMcpServer
