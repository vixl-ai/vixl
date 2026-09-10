import { tool } from 'ai'
import { z } from 'zod'
import { requestMcpAuth } from '@/services/mcp/mcp-auth-gate'
import { setMcpElicitationHandler } from '@/services/mcp/mcp-http-client'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import normalizeMcpToolArgs from '@/services/mcp/normalize-mcp-tool-args'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { mcpCapability } from '@/services/harness/permission/policy'
import { requestQuestion } from '@/services/harness/permission/question-gate'
import {
  isMcpAuthError,
  mcpAuthErrorMessage,
  mcpAuthKindForError,
} from '@/services/harness/mcp/auth'
import resolveTrustedMcpServer from '@/services/harness/mcp/resolve-trusted-server'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const callMcpTool = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Call an MCP tool on a running trusted server. Pass fields flat in args, never nested like query.query.',
    inputSchema: z.object({
      serverId: z.string().describe('MCP server id from config / get_mcp_tools'),
      tool: z.string().describe('Tool name from that server'),
      args: z
        .object({})
        .passthrough()
        .default({})
        .describe('Object matching the tool inputSchema'),
    }),
    execute: async ({ serverId, tool: toolName, args }, { toolCallId }) => {
      const trust = await resolveTrustedMcpServer(ctx, serverId)
      if (!trust.trusted) {
        if (trust.reason === 'missing') {
          return {
            error: `MCP server "${serverId}" was not found in any mcp.json config. It may have been removed, or the config failed to load.`,
          }
        }
        return {
          error: `MCP server "${serverId}" has not been granted trust. Open Settings → MCP and start the server to grant trust before the agent can call its tools.`,
        }
      }
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'call_mcp_tool',
        kind: 'mcp',
        action: 'mcp.call',
        capability: mcpCapability(serverId, toolName),
        title: ctx.subagentLabel
          ? `${ctx.subagentLabel}: ${serverId}/${toolName}`
          : `${serverId}/${toolName}`,
        serverId,
      })
      if (!allowed) {
        return { rejected: true, error: 'MCP call denied' }
      }

      const status = await mcpRuntime.getStatus(serverId, trust.config, trust.scopeKey)
      const toolInfo = status.tools.find((item) => item.name === toolName)
      const normalized = normalizeMcpToolArgs(
        (args ?? {}) as Record<string, unknown>,
        toolInfo?.inputSchema ?? null,
      )
      if (!normalized.ok) {
        return { error: normalized.error, isError: true }
      }
      const toolArgs = normalized.args

      const invokeTool = async (): Promise<unknown> => {
        const previous = setMcpElicitationHandler(async (request) => {
          const decision = await requestQuestion(
            ctx.chatId,
            `${toolCallId}:elicit`,
            `${request.params.message}\n\nWarning: MCP servers may phish for secrets. Never paste passwords or API keys. Choose Accept, Decline, or Cancel.`,
            ['Accept', 'Decline', 'Cancel'],
          )
          if (decision === 'Decline') {
            return { action: 'decline' as const }
          }
          if (decision !== 'Accept') {
            return { action: 'cancel' as const }
          }
          const answer = await requestQuestion(
            ctx.chatId,
            `${toolCallId}:elicit-content`,
            'Optional response for Accept (leave blank if none). Do not paste secrets.',
          )
          return {
            action: 'accept' as const,
            content: answer.trim().length > 0 ? { answer } : {},
          }
        })
        try {
          return await mcpRuntime.callTool(
            serverId,
            toolName,
            toolArgs,
            undefined,
            trust.scopeKey,
          )
        } finally {
          setMcpElicitationHandler(previous)
        }
      }

      try {
        return await invokeTool()
      } catch (error) {
        if (!isMcpAuthError(error)) {
          throw error
        }

        const kind = mcpAuthKindForError(error)
        const resolution = await requestMcpAuth({
          chatId: ctx.chatId,
          toolCallId,
          serverId,
          scopeKey: trust.scopeKey,
          kind,
          title: ctx.subagentLabel
            ? `Authenticate ${serverId} (${ctx.subagentLabel})`
            : `Authenticate ${serverId}`,
          detail:
            kind === 'client'
              ? 'This authorization server needs a client ID. Enter the client ID from the server. Optional client secret is stored in the keychain only.'
              : mcpAuthErrorMessage(error),
          subagentId: ctx.subagentId,
          subagentLabel: ctx.subagentLabel,
        })

        if (resolution.action !== 'authenticated') {
          return { error: 'auth_required', serverId }
        }

        try {
          return await invokeTool()
        } catch (retryError) {
          if (isMcpAuthError(retryError)) {
            return { error: 'auth_required', serverId }
          }
          throw retryError
        }
      }
    },
  })

export default callMcpTool
