import { tool } from 'ai'
import { z } from 'zod'
import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import type { McpToolInfo } from '@/services/vixl/vixl-tauri'
import { truncateMcpDescription } from '@/services/harness/mcp/auth'
import {
  listUnionedMcpServers,
  resolveUnionedMcpServer,
  type UnionedMcpServer,
} from '@/services/mcp/union-member-servers'
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
  server: UnionedMcpServer,
  settings: VixlSettings,
  includeSchemas: boolean,
) => {
  const fingerprint = mcpServerFingerprint(server.config)
  const trusted = isMcpTrusted(
    settings,
    server.id,
    fingerprint,
    sessionTrusts,
    server.scopeKey,
  )
  try {
    const state = await mcpRuntime.getStatus(server.id, undefined, server.scopeKey)
    return {
      serverId: server.displayId,
      scope: server.scope,
      status: state.status,
      trusted,
      authRequired: state.status === 'auth_required',
      error: state.error ?? null,
      tools: mapTools(state.tools, includeSchemas),
    }
  } catch (error) {
    return {
      serverId: server.displayId,
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
      'List configured MCP servers and tool names. Pass serverId for full tool schemas and examples from that server.',
    inputSchema: z.object({
      serverId: z.string().optional(),
    }),
    execute: async ({ serverId }) => {
      const servers = await listUnionedMcpServers(ctx.projectRoot, ctx.members)

      if (serverId) {
        const server = resolveUnionedMcpServer(servers, serverId, ctx.members)
        if ('error' in server) {
          return { error: server.error }
        }
        return catalogEntry(server, ctx.settings, true)
      }

      const catalog = await Promise.all(
        servers.map((server) => catalogEntry(server, ctx.settings, false)),
      )
      return { servers: catalog }
    },
  })

export default getMcpTools
