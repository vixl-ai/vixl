import { tool } from 'ai'
import { z } from 'zod'
import { migrateMcpConfig } from '@/schemas/mcp-config'
import { listUserMcpServers } from '@/services/mcp/merge-mcp-config'
import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { readMcpConfig } from '@/services/vixl/vixl-tauri'
import { truncateMcpDescription } from '@/services/harness/mcp/auth'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const getMcpTools = (ctx: HarnessToolContext) =>
  tool({
    description:
      'List configured MCP servers and their tools (name, description, inputSchema, inputExamples). Call before call_mcp_tool when unsure. No arguments.',
    inputSchema: z.object({}),
    execute: async () => {
      const personal = migrateMcpConfig(await readMcpConfig('personal', null))
      const projectRaw = await readMcpConfig('project', ctx.projectRoot).catch(() => null)
      const project = projectRaw ? migrateMcpConfig(projectRaw) : null
      const servers = listUserMcpServers(personal, project)

      const catalog = await Promise.all(
        servers.map(async (server) => {
          const fingerprint = mcpServerFingerprint(server.config)
          const trusted = isMcpTrusted(
            ctx.settings,
            server.id,
            fingerprint,
            sessionTrusts,
          )
          try {
            const state = await mcpRuntime.getStatus(server.id)
            return {
              serverId: server.id,
              scope: server.scope,
              status: state.status,
              trusted,
              authRequired: state.status === 'auth_required',
              error: state.error ?? null,
              tools: state.tools.map((item) => {
                const meta = item.meta ?? null
                const inputExamples =
                  meta &&
                  typeof meta === 'object' &&
                  'inputExamples' in meta
                    ? meta.inputExamples
                    : null
                return {
                  name: item.name,
                  description: truncateMcpDescription(item.description),
                  inputSchema: item.inputSchema ?? null,
                  inputExamples: inputExamples ?? null,
                }
              }),
            }
          } catch (error) {
            return {
              serverId: server.id,
              scope: server.scope,
              status: 'error',
              trusted,
              authRequired: false,
              error: error instanceof Error ? error.message : String(error),
              tools: [],
            }
          }
        }),
      )

      return { servers: catalog }
    },
  })

export default getMcpTools
