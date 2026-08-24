import { ref, shallowRef } from 'vue'
import type { ChatStatus } from 'ai'
import type { AgentHarnessOptions } from '@/types/harness/agent-harness-options'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { SubagentEntry } from '@/types/harness/subagent-entry'
import type { ToolRun } from '@/types/harness/tool-run'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { TurnUsageAggregate } from '@/types/billing/turn-usage-aggregate'
import type { PermissionLevel } from '@/types/harness/permission'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import type { PendingMcpAuthView } from '@/types/chat/pending-mcp-auth'
import useChatStore from '@/composables/use-chat-store'
import useContextUsage from '@/composables/use-context-usage'
import useChatContextBudgetSync from '@/composables/use-chat-context-budget-sync'
import useVixlConfig from '@/composables/use-vixl-config'
import useFleetSidebar from '@/composables/use-fleet-sidebar'
import useWorkbenchStore from '@/composables/use-workbench-store'
import useMcpServers from '@/composables/use-mcp-servers'
import useMessageQueue from '@/composables/use-message-queue'
import createApprovals from './approvals'
import createEvents from './events'
import createHelpers, { makeHarnessKey } from './helpers'
import createLifecycle from './lifecycle'
import createPersistence from './persistence'
import createSessionOps from './session-ops'
import createTurnLoop from './turn-loop'
import type { AgentHarnessState, LastRunConfig } from './types'
import { releaseLocksForChat } from '@/services/browser/registry'

type AgentHarness = ReturnType<typeof createAgentHarness>

const harnessCache = new Map<string, AgentHarness>()

export const dropAgentHarness = (projectSlug: string, chatId: string): void => {
  const key = makeHarnessKey(projectSlug, chatId)
  const existing = harnessCache.get(key)
  harnessCache.delete(key)
  releaseLocksForChat(chatId, 'chat_deleted')
  if (existing) {
    existing.dispose().catch(() => undefined)
  }
}

export const resetAgentHarnessCacheForTests = (): void => {
  harnessCache.clear()
}

const createAgentHarness = (options: AgentHarnessOptions) => {
  const chatStore = useChatStore()
  const session = chatStore.forChat(options.projectSlug, options.chatId)
  const config = useVixlConfig()
  const contextUsage = useContextUsage()
  const contextBudgetSync = useChatContextBudgetSync()
  const fleetSidebar = useFleetSidebar()
  const workbench = useWorkbenchStore()
  const mcpServers = useMcpServers()
  const messageQueue = useMessageQueue()

  const state: AgentHarnessState = {
    options,
    session,
    config,
    contextUsage,
    contextBudgetSync,
    fleetSidebar,
    workbench,
    mcpServers,
    messageQueue,
    chatStore,
    status: ref<ChatStatus>('ready'),
    error: ref<string | null>(null),
    pendingApprovals: shallowRef<PendingApprovalView[]>([]),
    pendingMcpAuth: shallowRef<PendingMcpAuthView[]>([]),
    toolRuns: shallowRef<ToolRun[]>([]),
    subagents: shallowRef<SubagentEntry[]>([]),
    abortController: ref<AbortController | null>(null),
    liveEvents: ref<HarnessEvent[]>([]),
    sessionPermissionLevel: ref<PermissionLevel | null>(null),
    lastRunConfig: ref<LastRunConfig | null>(null),
    resumingBackgroundBatch: ref(false),
    billableUsageRecords: shallowRef<BillableUsageRecord[]>([]),
    turnUsageByTurnId: shallowRef<Record<string, TurnUsageAggregate>>({}),
    mcpAuthPollTimer: { current: null },
  }

  const attention = createHelpers(state)
  const approvals = createApprovals(state, attention)

  const flushRef: { current: (() => void) | null } = { current: null }

  const events = createEvents(state, attention, {
    startMcpAuthPolling: approvals.startMcpAuthPolling,
    syncPendingMcpAuth: approvals.syncPendingMcpAuth,
    maybeFlushBackgroundSubagentResume: () => {
      flushRef.current?.()
    },
  })

  const turnLoop = createTurnLoop(state, attention, {
    handleEvent: events.handleEvent,
    persistPermission: approvals.persistPermission,
  })
  flushRef.current = turnLoop.maybeFlushBackgroundSubagentResume

  const persistence = createPersistence(state, {
    send: turnLoop.send,
  })
  const sessionOps = createSessionOps(state, {
    handleEvent: events.handleEvent,
  })
  const lifecycle = createLifecycle(state, attention, {
    send: turnLoop.send,
    stopMcpAuthPolling: approvals.stopMcpAuthPolling,
    maybeFlushBackgroundSubagentResume: turnLoop.maybeFlushBackgroundSubagentResume,
  })

  return {
    status: state.status,
    error: state.error,
    pendingApprovals: state.pendingApprovals,
    pendingMcpAuth: state.pendingMcpAuth,
    sessionPermissionLevel: state.sessionPermissionLevel,
    lastRunConfig: state.lastRunConfig,
    toolRuns: state.toolRuns,
    subagents: state.subagents,
    liveEvents: state.liveEvents,
    billableUsageRecords: state.billableUsageRecords,
    turnUsageByTurnId: state.turnUsageByTurnId,
    queuedMessages: messageQueue.items,
    isWaitingOnBackground: attention.isWaitingOnBackground,
    send: turnLoop.send,
    submitEditMessage: persistence.submitEditMessage,
    retryLastTurn: persistence.retryLastTurn,
    restoreAgentTurnFiles: persistence.restoreAgentTurnFiles,
    getFileMutationsAfterMessage: persistence.getFileMutationsAfterMessage,
    getLastTurnFileMutations: persistence.getLastTurnFileMutations,
    stop: lifecycle.stop,
    stopSubagent: lifecycle.stopSubagent,
    approve: approvals.approve,
    reject: approvals.reject,
    resolveApprovalDecision: approvals.resolveApprovalDecision,
    resolveMcpAuthDecision: approvals.resolveMcpAuthDecision,
    authenticatePendingMcpAuth: approvals.authenticatePendingMcpAuth,
    setPermissionLevel: approvals.setPermissionLevel,
    submitAnswer: approvals.submitAnswer,
    compactChat: sessionOps.compactChat,
    createHandoff: sessionOps.createHandoff,
    restorePendingApprovals: approvals.restorePendingApprovals,
    forceSendQueued: lifecycle.forceSendQueued,
    cancelQueued: lifecycle.cancelQueued,
    editQueued: lifecycle.editQueued,
    dispose: lifecycle.dispose,
  }
}

export default (options: AgentHarnessOptions): AgentHarness => {
  const key = makeHarnessKey(options.projectSlug, options.chatId)
  const existing = harnessCache.get(key)
  if (existing) {
    return existing
  }
  const harness = createAgentHarness(options)
  harnessCache.set(key, harness)
  return harness
}

export type { AgentHarnessOptions } from '@/types/harness/agent-harness-options'
export type { ToolRun } from '@/types/harness/tool-run'
export type { SubagentEntry } from '@/types/harness/subagent-entry'
export type { ApprovalResolution } from '@/services/harness/permission/approval-gate'
export type { PendingApprovalView } from '@/services/harness/permission/gate'
export type { McpAuthResolution } from '@/services/mcp/mcp-auth-gate'
export type { PendingMcpAuthView } from '@/types/chat/pending-mcp-auth'
