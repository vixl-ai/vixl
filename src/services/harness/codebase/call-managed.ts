import { requestMcpAuth } from '@/services/mcp/mcp-auth-gate'
import { setMcpElicitationHandler } from '@/services/mcp/mcp-http-client'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { requestQuestion } from '@/services/harness/permission/question-gate'
import {
  isMcpAuthError,
  mcpAuthErrorMessage,
  mcpAuthKindForError,
} from '@/services/harness/mcp/auth'
import { CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import type { HarnessToolContext } from '@/types/harness/tool-context'

type ManagedCodegraphCallResult =
  | { ok: true; result: unknown }
  | { ok: false; payload: Record<string, unknown> }

const callManagedCodegraphTool = async (
  ctx: HarnessToolContext,
  args: {
    toolCallId: string
    firstPartyName: string
    mcpToolName: string
    toolArgs: Record<string, unknown>
  },
): Promise<ManagedCodegraphCallResult> => {
  const serverId = CODEGRAPH_SERVER_ID
  // Product-owned CodeGraph tools skip user MCP trust and per-tool permission cards.
  // Lifecycle is owned by ensureCodeGraph + the status chip runtime path.

  const invokeTool = async (): Promise<unknown> => {
    const previous = setMcpElicitationHandler(async (request) => {
      const decision = await requestQuestion(
        ctx.chatId,
        `${args.toolCallId}:elicit`,
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
        `${args.toolCallId}:elicit-content`,
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
        args.mcpToolName,
        args.toolArgs,
        undefined,
        ctx.projectRoot,
      )
    } finally {
      setMcpElicitationHandler(previous)
    }
  }

  try {
    return { ok: true, result: await invokeTool() }
  } catch (error) {
    if (!isMcpAuthError(error)) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, payload: { error: message } }
    }

    const kind = mcpAuthKindForError(error)
    const resolution = await requestMcpAuth({
      chatId: ctx.chatId,
      toolCallId: args.toolCallId,
      serverId,
      scopeKey: ctx.projectRoot,
      kind,
      title: ctx.subagentLabel
        ? `Authenticate ${serverId} (${ctx.subagentLabel})`
        : `Authenticate ${serverId}`,
      detail: mcpAuthErrorMessage(error),
      subagentId: ctx.subagentId,
      subagentLabel: ctx.subagentLabel,
    })

    if (resolution.action !== 'authenticated') {
      return { ok: false, payload: { error: 'auth_required', serverId } }
    }

    try {
      return { ok: true, result: await invokeTool() }
    } catch (retryError) {
      if (isMcpAuthError(retryError)) {
        return { ok: false, payload: { error: 'auth_required', serverId } }
      }
      const message = retryError instanceof Error ? retryError.message : String(retryError)
      return { ok: false, payload: { error: message } }
    }
  }
}

export default callManagedCodegraphTool
