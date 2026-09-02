import { toast } from 'vue-sonner'
import type { PermissionCapabilityKey, PermissionRecord } from '@/types/harness/permission'
import {
  listPendingApprovalsForChat,
  resolveApproval,
  type ApprovalResolution,
} from '@/services/harness/permission/approval-gate'
import {
  listPendingMcpAuthForChat,
  resolveMcpAuth,
  resolveMcpAuthForServer,
  type McpAuthResolution,
} from '@/services/mcp/mcp-auth-gate'
import { requestQuestion } from '@/services/harness/permission/question-gate'
import { listEffectiveMcpServers } from '@/services/mcp/merge-mcp-config'
import { parsePermissionRecords } from '@/services/harness/permission/policy'
import type { AgentHarnessState, AttentionHelpers } from './types'

export default (state: AgentHarnessState, attention: AttentionHelpers) => {
  const {
    options,
    config,
    mcpServers,
    pendingApprovals,
    pendingMcpAuth,
    sessionPermissionLevel,
    mcpAuthPollTimer,
    status,
  } = state

  const syncPendingMcpAuth = (): void => {
    const next = listPendingMcpAuthForChat(options.chatId).map((entry) => ({
      chatId: entry.chatId,
      toolCallId: entry.toolCallId,
      serverId: entry.serverId,
      kind: entry.kind,
      title: entry.title,
      detail: entry.detail,
      subagentId: entry.subagentId,
      subagentLabel: entry.subagentLabel,
    }))
    const hadPending = pendingMcpAuth.value.length > 0
    pendingMcpAuth.value = next
    if (next.length > 0) {
      attention.setChatAttention('needs_mcp_auth')
      return
    }
    if (hadPending) {
      attention.maybeClearAttentionWhenGatesEmpty()
    }
  }

  const stopMcpAuthPolling = (): void => {
    if (!mcpAuthPollTimer.current) {
      return
    }
    clearInterval(mcpAuthPollTimer.current)
    mcpAuthPollTimer.current = null
  }

  const startMcpAuthPolling = (): void => {
    if (mcpAuthPollTimer.current) {
      return
    }
    mcpAuthPollTimer.current = setInterval(() => {
      syncPendingMcpAuth()
      const live =
        status.value === 'streaming' ||
        status.value === 'submitted' ||
        pendingMcpAuth.value.length > 0
      if (!live) {
        stopMcpAuthPolling()
      }
    }, 250)
  }

  const persistPermission = async (
    capability: PermissionCapabilityKey,
    verdict: 'allow' | 'deny',
    scope: 'workspace' | 'always',
  ): Promise<void> => {
    const tab = scope === 'workspace' ? 'project' : 'personal'
    if (tab === 'project' && !config.activeRootPath.value) {
      toast.error('Cannot save workspace permission', {
        description: 'No active project is open.',
      })
      return
    }
    const settings = config.getScopeSettings(tab)
    const existing = parsePermissionRecords(settings['agent.permissions'])
    const idx = existing.findIndex((r) => r.capability === capability)
    const record: PermissionRecord = { capability, verdict, scope }
    const updated: PermissionRecord[] =
      idx >= 0 ? existing.map((r, i) => (i === idx ? record : r)) : [...existing, record]
    await config.updateSetting(tab, 'agent.permissions', updated)
  }

  const resolveApprovalDecision = (toolCallId: string, resolution: ApprovalResolution): void => {
    resolveApproval(toolCallId, resolution)
    pendingApprovals.value = pendingApprovals.value.filter(
      (item) => item.toolCallId !== toolCallId,
    )
    attention.maybeClearAttentionWhenGatesEmpty()
  }

  const resolveMcpAuthDecision = (
    toolCallId: string,
    resolution: McpAuthResolution,
  ): void => {
    resolveMcpAuth(toolCallId, resolution)
    syncPendingMcpAuth()
    attention.maybeClearAttentionWhenGatesEmpty()
  }

  const confirmAsOriginForChat = async (origin: string): Promise<boolean> => {
    const answer = await requestQuestion(
      options.chatId,
      `mcp-as-confirm-${crypto.randomUUID()}`,
      `Trust OAuth authorization server origin ${origin}? Only confirm origins you trust.`,
      ['Trust', 'Cancel'],
    )
    return answer === 'Trust'
  }

  const authenticatePendingMcpAuth = async (toolCallId: string): Promise<void> => {
    const entry =
      pendingMcpAuth.value.find((item) => item.toolCallId === toolCallId) ??
      listPendingMcpAuthForChat(options.chatId).find((item) => item.toolCallId === toolCallId)
    if (!entry) {
      toast.error('MCP authentication request expired')
      return
    }

    const rootPath = options.standalone ? null : options.projectRoot
    if (
      Object.keys(mcpServers.personalMcp.value.servers).length === 0 &&
      Object.keys(mcpServers.projectMcp.value.servers).length === 0
    ) {
      try {
        await mcpServers.loadConfigs(rootPath)
      } catch (error) {
        toast.error('Failed to load MCP config', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        return
      }
    }

    const effective = listEffectiveMcpServers(
      mcpServers.personalMcp.value,
      mcpServers.projectMcp.value,
    )
    const server = effective.find((item) => item.id === entry.serverId)
    if (!server) {
      toast.error('MCP server not found', {
        description: entry.serverId,
      })
      return
    }

    try {
      await mcpServers.authenticateServer(entry.serverId, server.config, {
        confirmAuthorizationServerOrigin: confirmAsOriginForChat,
      })
      resolveMcpAuthForServer(entry.serverId, { action: 'authenticated' })
      syncPendingMcpAuth()
      attention.maybeClearAttentionWhenGatesEmpty()
    } catch (error) {
      if (!(error instanceof Error)) {
        toast.error('MCP authentication failed', {
          description: String(error),
        })
      }
    }
  }

  const setPermissionLevel = (level: typeof sessionPermissionLevel.value): void => {
    sessionPermissionLevel.value = level
  }

  const restorePendingApprovals = (): void => {
    pendingApprovals.value = listPendingApprovalsForChat(options.chatId).map((entry) => ({
      toolCallId: entry.toolCallId,
      name: entry.name,
      kind: entry.kind,
      title: entry.title,
      detail: entry.detail,
      unsandboxed: entry.unsandboxed,
      needsNetwork: entry.needsNetwork,
      allowedScopes: entry.allowedScopes,
      diff: entry.diff,
      subagentId: entry.subagentId,
      subagentLabel: entry.subagentLabel,
    }))
    syncPendingMcpAuth()
    if (pendingMcpAuth.value.length > 0) {
      startMcpAuthPolling()
    }
  }

  const approve = (toolCallId: string): void => {
    resolveApprovalDecision(toolCallId, { approved: true, scope: 'once' })
  }

  const reject = (toolCallId: string): void => {
    resolveApprovalDecision(toolCallId, { approved: false, scope: 'once' })
  }

  const submitAnswer = (toolCallId: string, answer: string): void => {
    state.session.submitAnswer(toolCallId, answer)
    attention.maybeClearAttentionWhenGatesEmpty()
  }

  return {
    syncPendingMcpAuth,
    stopMcpAuthPolling,
    startMcpAuthPolling,
    persistPermission,
    resolveApprovalDecision,
    resolveMcpAuthDecision,
    authenticatePendingMcpAuth,
    setPermissionLevel,
    restorePendingApprovals,
    approve,
    reject,
    submitAnswer,
  }
}
