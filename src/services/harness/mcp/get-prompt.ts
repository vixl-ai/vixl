import { tool } from 'ai'
import { z } from 'zod'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { mcpCapability } from '@/services/harness/permission/policy'
import resolveTrustedMcpServer from '@/services/harness/mcp/resolve-trusted-server'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const getMcpPrompt = (ctx: HarnessToolContext) =>
  tool({
    description: 'Retrieve a prompt template from a connected MCP server.',
    inputSchema: z.object({
      serverId: z.string(),
      name: z.string().describe('Prompt name'),
      args: z.record(z.unknown()).optional().describe('Prompt arguments'),
    }),
    execute: async ({ serverId, name, args }, { toolCallId }) => {
      const trust = await resolveTrustedMcpServer(ctx, serverId)
      if (!trust.trusted) {
        return {
          error: `MCP server "${serverId}" has not been granted trust.`,
        }
      }
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'get_mcp_prompt',
        kind: 'mcp',
        action: 'mcp.call',
        capability: mcpCapability(serverId, `prompts/${name}`),
        title: `${serverId}/prompt ${name}`,
        serverId,
      })
      if (!allowed) {
        return { rejected: true, error: 'MCP prompt denied' }
      }
      return mcpRuntime.getPrompt(
        serverId,
        name,
        args as Record<string, unknown> | undefined,
        trust.scopeKey,
      )
    },
  })

export default getMcpPrompt
