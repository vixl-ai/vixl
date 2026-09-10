import { tool } from 'ai'
import { z } from 'zod'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { mcpCapability } from '@/services/harness/permission/policy'
import resolveTrustedMcpServer from '@/services/harness/mcp/resolve-trusted-server'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const readMcpResource = (ctx: HarnessToolContext) =>
  tool({
    description: 'Read a resource URI from a connected MCP server.',
    inputSchema: z.object({
      serverId: z.string(),
      uri: z.string().describe('Resource URI from list_mcp_resources'),
    }),
    execute: async ({ serverId, uri }, { toolCallId }) => {
      const trust = await resolveTrustedMcpServer(ctx, serverId)
      if (!trust.trusted) {
        return {
          error: `MCP server "${serverId}" has not been granted trust.`,
        }
      }
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'read_mcp_resource',
        kind: 'mcp',
        action: 'mcp.call',
        capability: mcpCapability(serverId, 'resources/read'),
        title: `${serverId}/read ${uri}`,
        serverId,
      })
      if (!allowed) {
        return { rejected: true, error: 'MCP resource read denied' }
      }
      return mcpRuntime.readResource(serverId, uri, trust.scopeKey)
    },
  })

export default readMcpResource
