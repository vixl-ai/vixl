import { defaultMcpConfig, parseMcpConfig } from '@/schemas/mcp-config'
import { listEffectiveMcpServers } from '@/services/mcp/merge-mcp-config'
import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import { readMcpConfig } from '@/services/vixl/vixl-tauri'
import {
  buildCodegraphServer,
  isInternalMcpServer,
} from '@/types/codegraph/managed-codegraph'
import type { TrustedMcpServerResult } from '@/types/harness/trusted-mcp-server'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { McpConfig } from '@/types/vixl/mcp-config'

const configFromRaw = (raw: unknown): McpConfig | null => {
  const parsed = parseMcpConfig(raw)
  if (!parsed.ok) {
    return null
  }
  return parsed.config
}

const resolveTrustedMcpServer = async (
  ctx: HarnessToolContext,
  serverId: string,
): Promise<TrustedMcpServerResult> => {
  // First-party CodeGraph is in-memory only (stripped from user mcp.json).
  if (isInternalMcpServer(serverId)) {
    return {
      trusted: true,
      config: buildCodegraphServer(ctx.projectRoot),
      scopeKey: ctx.projectRoot,
    }
  }

  const personalRaw = await readMcpConfig('personal', null).catch(() => null)
  const personal = configFromRaw(personalRaw) ?? defaultMcpConfig()
  const projectRaw = await readMcpConfig('project', ctx.projectRoot).catch(() => null)
  const project = projectRaw ? configFromRaw(projectRaw) : null
  const server = listEffectiveMcpServers(personal, project).find((item) => item.id === serverId)
  if (!server) {
    return { trusted: false, reason: 'missing' }
  }
  const scopeKey = server.scope === 'personal' ? 'personal' : ctx.projectRoot
  const fingerprint = mcpServerFingerprint(server.config)
  if (!isMcpTrusted(ctx.settings, serverId, fingerprint, sessionTrusts, scopeKey)) {
    return { trusted: false, reason: 'untrusted' }
  }
  return {
    trusted: true,
    config: server.config,
    scopeKey,
  }
}

export default resolveTrustedMcpServer
