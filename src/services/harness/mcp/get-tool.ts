import { tool } from 'ai'
import { z } from 'zod'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import {
  listUnionedMcpServers,
  resolveUnionedMcpServer,
} from '@/services/mcp/union-member-servers'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import inputExamplesFromMeta from './input-examples'

const getMcpTool = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Load the full schema and description for one MCP tool by serverId and tool name.',
    inputSchema: z.object({
      serverId: z.string().describe('Server id from get_mcp_tools'),
      tool: z.string().describe('Tool name from that server'),
    }),
    execute: async ({ serverId, tool: toolName }) => {
      const servers = await listUnionedMcpServers(ctx.projectRoot, ctx.members)
      const server = resolveUnionedMcpServer(servers, serverId, ctx.members)
      if ('error' in server) {
        return { error: server.error }
      }

      try {
        const state = await mcpRuntime.getStatus(server.id, undefined, server.scopeKey)
        if (state.status === 'error' || state.status === 'stopped') {
          return {
            error:
              state.error ??
              `MCP server "${serverId}" is not reachable (${state.status}).`,
          }
        }
        const item = state.tools.find((entry) => entry.name === toolName)
        if (!item) {
          return {
            error: `MCP tool "${toolName}" was not found on server "${serverId}".`,
          }
        }
        return {
          serverId: server.displayId,
          name: item.name,
          description: item.description ?? '',
          inputSchema: item.inputSchema ?? null,
          inputExamples: inputExamplesFromMeta(item.meta),
        }
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })

export default getMcpTool
