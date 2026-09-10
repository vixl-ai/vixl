import { tool } from 'ai'
import { z } from 'zod'
import { migrateMcpConfig } from '@/schemas/mcp-config'
import { listUserMcpServers, type EffectiveMcpServer } from '@/services/mcp/merge-mcp-config'
import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { readMcpConfig, type McpToolInfo } from '@/services/vixl/vixl-tauri'
import { truncateMcpDescription } from '@/services/harness/mcp/auth'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import inputExamplesFromMeta from './input-examples'

const mapTools = (tools: McpToolInfo[], includeSchemas: boolean) =>
  tools.map((item) => {
    const description = truncateMcpDescription(item.description)
    if (!includeSchemas) {
      return {
        name: item.name,
        description,
      }
    }
    return {
      name: item.name,
      description,
      inputSchema: item.inputSchema ?? null,
      inputExamples: inputExamplesFromMeta(item.meta),
    }
  })

const catalogEntry = async (
  server: EffectiveMcpServer,
  settings: VixlSettings,
  includeSchemas: boolean,
  projectRoot: string,
) => {
  const scopeKey = server.scope === 'personal' ? 'personal' : projectRoot
  const fingerprint = mcpServerFingerprint(server.config)
  const trusted = isMcpTrusted(
    settings,
    server.id,
    fingerprint,
    sessionTrusts,
    scopeKey,
  )
  try {
    const state = await mcpRuntime.getStatus(server.id, undefined, scopeKey)
    return {
      serverId: server.id,
      scope: server.scope,
      status: state.status,
      trusted,
      authRequired: state.status === 'auth_required',
      error: state.error ?? null,
      tools: mapTools(state.tools, includeSchemas),
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
}

const getMcpTools = (ctx: HarnessToolContext) =>
  tool({
    description:
      'List configured MCP servers and tool names. Pass serverId to include full tool schemas for one server.',
    inputSchema: z.object({
      serverId: z
        .string()
        .optional()
        .describe('When set, include full inputSchema and inputExamples for this server only'),
    }),
    execute: async ({ serverId }) => {
      const personal = migrateMcpConfig(await readMcpConfig('personal', null))
      const projectRaw = await readMcpConfig('project', ctx.projectRoot).catch(() => null)
      const project = projectRaw ? migrateMcpConfig(projectRaw) : null
      const servers = listUserMcpServers(personal, project)

      if (serverId) {
        const server = servers.find((entry) => entry.id === serverId)
        if (!server) {
          return {
            error: `MCP server "${serverId}" was not found in any mcp.json config.`,
          }
        }
        return catalogEntry(server, ctx.settings, true, ctx.projectRoot)
      }

      const catalog = await Promise.all(
        servers.map((server) =>
          catalogEntry(server, ctx.settings, false, ctx.projectRoot),
        ),
      )
      return { servers: catalog }
    },
  })

export default getMcpTools
