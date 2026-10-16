import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import {
  listUnionedMcpServers,
  resolveUnionedMcpServer,
} from '@/services/mcp/union-member-servers'
import {
  buildCodegraphServer,
  isInternalMcpServer,
} from '@/types/codegraph/managed-codegraph'
import type { TrustedMcpServerResult } from '@/types/harness/trusted-mcp-server'
import type { HarnessToolContext } from '@/types/harness/tool-context'

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
      id: serverId,
    }
  }

  const servers = await listUnionedMcpServers(ctx.projectRoot, ctx.members)
  const resolved = resolveUnionedMcpServer(servers, serverId, ctx.members)
  if ('error' in resolved) {
    return { trusted: false, reason: 'missing', error: resolved.error }
  }
  const fingerprint = mcpServerFingerprint(resolved.config)
  if (!isMcpTrusted(ctx.settings, resolved.id, fingerprint, sessionTrusts, resolved.scopeKey)) {
    return { trusted: false, reason: 'untrusted' }
  }
  return {
    trusted: true,
    config: resolved.config,
    scopeKey: resolved.scopeKey,
    id: resolved.id,
  }
}

export default resolveTrustedMcpServer
