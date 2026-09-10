import { tool } from 'ai'
import { z } from 'zod'
import { migrateMcpConfig } from '@/schemas/mcp-config'
import { listUserMcpServers } from '@/services/mcp/merge-mcp-config'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { readMcpConfig } from '@/services/vixl/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import inputExamplesFromMeta from './input-examples'

const getMcpTool = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Load the full schema and description for one MCP tool by serverId and tool name.',
    inputSchema: z.object({
      serverId: z.string().describe('MCP server id from config / get_mcp_tools'),
      tool: z.string().describe('Tool name from that server'),
    }),
    execute: async ({ serverId, tool: toolName }) => {
      const personal = migrateMcpConfig(await readMcpConfig('personal', null))
      const projectRaw = await readMcpConfig('project', ctx.projectRoot).catch(() => null)
      const project = projectRaw ? migrateMcpConfig(projectRaw) : null
      const servers = listUserMcpServers(personal, project)
      const server = servers.find((entry) => entry.id === serverId)
      if (!server) {
        return {
          error: `MCP server "${serverId}" was not found in any mcp.json config.`,
        }
      }

      try {
        const state = await mcpRuntime.getStatus(serverId)
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
          serverId,
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
