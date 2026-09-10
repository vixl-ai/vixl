import { tool } from 'ai'
import { z } from 'zod'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { mcpCapability } from '@/services/harness/permission/policy'
import resolveTrustedMcpServer from '@/services/harness/mcp/resolve-trusted-server'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const listMcpResources = (ctx: HarnessToolContext) =>
  tool({
    description: 'List resources from a trusted connected MCP server.',
    inputSchema: z.object({
      serverId: z.string().describe('MCP server id'),
    }),
    execute: async ({ serverId }, { toolCallId }) => {
      const trust = await resolveTrustedMcpServer(ctx, serverId)
      if (!trust.trusted) {
        return {
          error: `MCP server "${serverId}" has not been granted trust.`,
        }
      }
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'list_mcp_resources',
        kind: 'mcp',
        action: 'mcp.call',
        capability: mcpCapability(serverId, 'resources/list'),
        title: `${serverId}/resources`,
        serverId,
      })
      if (!allowed) {
        return { rejected: true, error: 'MCP resources denied' }
      }
      return mcpRuntime.listResources(serverId, trust.scopeKey)
    },
  })

export default listMcpResources
