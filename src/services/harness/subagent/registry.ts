import type { ModelMessage } from 'ai'
import { ref } from 'vue'
import type {
  SubagentRecord,
  SubagentResult,
  SubagentStatus,
  SubagentWorkspace,
} from '@/types/harness/subagent-record'
import {
  forgetBackgroundResultTracking,
  resetBackgroundResultSetsForTests,
} from '@/services/harness/subagent/background-result-sets'
import {
  classifySubagentOrigin,
  forgetBlockingOriginSubagent,
  listDeliverableResults,
  markBlockingOriginReopened,
  resetBlockingOriginSetsForTests,
} from '@/services/harness/subagent/blocking-origin-sets'
import { clearSteers, resetInboxForTests } from '@/services/harness/subagent/inbox'
import forgetResumeOverlayDelivery from '@/services/harness/orchestrator/forget-resume-overlay-delivery'
import {
  resetCompletionWaitersForTests,
  resolveCompletionWaiters,
  waitForSubagent,
} from '@/services/harness/subagent/registry-completion'
import {
  pruneChatSubagentIds,
  restoreSubagentRecord,
} from '@/services/harness/subagent/registry-restore'

export {
  isBackgroundResultFinalized,
  markBackgroundResultsDelivered,
  markBackgroundResultsFinalized,
} from '@/services/harness/subagent/background-result-sets'

const subagents = new Map<string, SubagentRecord>()
const chatSubagents = new Map<string, Set<string>>()
const controllers = new Map<string, AbortController>()
const turnResponseMessages = new Map<string, ModelMessage[]>()
const pendingBackgroundResume = new Set<string>()
const blockingSubagents = new Set<string>()
const backgroundSubagents = new Set<string>()
const restoredBackgroundSubagents = new Set<string>()

const registryMaps = {
  subagents,
  chatSubagents,
  controllers,
  blockingSubagents,
  backgroundSubagents,
  restoredBackgroundSubagents,
  pendingBackgroundResume,
}

export const subagentRegistryRevision = ref(0)

const bumpRevision = (): void => {
  subagentRegistryRevision.value++
}

const setSubagentStatus = (
  record: SubagentRecord,
  status: SubagentStatus,
  result?: SubagentResult,
): void => {
  record.status = status
  if (result) {
    record.result = result
  }
}

const trackSubagentForChat = (chatId: string, subagentId: string): void => {
  const existing = chatSubagents.get(chatId) ?? new Set<string>()
  existing.add(subagentId)
  chatSubagents.set(chatId, existing)
}

export const register = (
  chatId: string,
  subagentId: string,
  controller: AbortController,
  meta: {
    toolCallId: string
    agentName: string
    prompt?: string
    model?: string
    capabilities?: 'read-only' | 'write'
    workspace?: SubagentWorkspace
  },
  options?: { pendingResume?: boolean },
): SubagentRecord => {
  const record: SubagentRecord = {
    subagentId,
    chatId,
    toolCallId: meta.toolCallId,
    agentName: meta.agentName,
    status: 'running',
    startedAt: new Date().toISOString(),
    prompt: meta.prompt,
    model: meta.model,
    capabilities: meta.capabilities,
    workspace: meta.workspace,
  }

  subagents.set(subagentId, record)
  controllers.set(subagentId, controller)
  trackSubagentForChat(chatId, subagentId)
  // pendingResume: false at register marks a blocking subagent.
  if (options?.pendingResume !== false) {
    pendingBackgroundResume.add(chatId)
    backgroundSubagents.add(subagentId)
  } else {
    blockingSubagents.add(subagentId)
  }
  classifySubagentOrigin(subagentId, options?.pendingResume === false)
  bumpRevision()
  return record
}

export const resolve = (subagentId: string, result: SubagentResult): void => {
  const record = subagents.get(subagentId)
  if (!record || record.status !== 'running') {
    return
  }

  setSubagentStatus(record, 'completed', result)
  controllers.delete(subagentId)
  blockingSubagents.delete(subagentId)
  resolveCompletionWaiters(subagentId, result)
  bumpRevision()
}

export const fail = (subagentId: string, summary: string): void => {
  const record = subagents.get(subagentId)
  if (!record || record.status !== 'running') {
    return
  }

  const result: SubagentResult = { subagentId, name: record.agentName, summary }
  setSubagentStatus(record, 'failed', result)
  controllers.delete(subagentId)
  blockingSubagents.delete(subagentId)
  resolveCompletionWaiters(subagentId, result)
  bumpRevision()
}

export const waitFor = (chatId: string, subagentId: string): Promise<SubagentResult> =>
  waitForSubagent(subagents.get(subagentId) ?? null, chatId, subagentId)

export const getSubagent = (subagentId: string): SubagentRecord | null =>
  subagents.get(subagentId) ?? null

export const hasSubagent = (subagentId: string): boolean => subagents.has(subagentId)

export const listSubagentsForChat = (chatId: string): SubagentRecord[] =>
  [...(chatSubagents.get(chatId) ?? [])]
    .map((subagentId) => subagents.get(subagentId))
    .filter((record): record is SubagentRecord => record !== undefined)

export const listSubagents = (): SubagentRecord[] => [...subagents.values()]

export const isRunningSubagent = (record: SubagentRecord): boolean =>
  record.status === 'running'

export const hasRunningSubagentsForChat = (chatId: string): boolean =>
  listSubagentsForChat(chatId).some(isRunningSubagent)

export const isRunningBackgroundSubagent = (subagentId: string): boolean =>
  subagents.get(subagentId)?.status === 'running' &&
  !blockingSubagents.has(subagentId)

export const getRunningSubagentForChat = (chatId: string): SubagentRecord | null =>
  listSubagentsForChat(chatId).find(isRunningSubagent) ?? null

export const isBackgroundSubagent = (subagentId: string): boolean =>
  backgroundSubagents.has(subagentId)

export const hasPendingBackgroundResume = (chatId: string): boolean =>
  pendingBackgroundResume.has(chatId)

export const clearPendingBackgroundResume = (chatId: string): void => {
  if (!pendingBackgroundResume.delete(chatId)) {
    return
  }
  bumpRevision()
}

export const listDeliverableBackgroundResults = (
  chatId: string,
): Array<{ toolCallId: string; result: SubagentResult }> =>
  listDeliverableResults(chatId, listSubagentsForChat(chatId), isBackgroundSubagent)

export const setTurnResponseMessages = (chatId: string, messages: ModelMessage[]): void => {
  turnResponseMessages.set(chatId, messages)
}

export const getTurnResponseMessages = (chatId: string): ModelMessage[] | null =>
  turnResponseMessages.get(chatId) ?? null

export const clearTurnResponseMessages = (chatId: string): void => {
  turnResponseMessages.delete(chatId)
}

export const setMessages = (subagentId: string, messages: ModelMessage[]): void => {
  const record = subagents.get(subagentId)
  if (!record) {
    return
  }
  record.messages = messages
}

export const appendMessages = (subagentId: string, extra: ModelMessage[]): void => {
  const record = subagents.get(subagentId)
  if (!record || extra.length === 0) {
    return
  }
  record.messages = [...(record.messages ?? []), ...extra]
}

export const restoreSubagent = (
  record: SubagentRecord,
  options?: { background?: boolean },
): SubagentRecord | null =>
  restoreSubagentRecord(registryMaps, record, options, {
    trackSubagentForChat,
    bumpRevision,
  })

export const pruneSubagentsForChat = (
  chatId: string,
  keptSubagentIds: ReadonlySet<string>,
): void => pruneChatSubagentIds(registryMaps, chatId, keptSubagentIds, bumpRevision)

const canReopen = (status: SubagentStatus): boolean =>
  status === 'completed' || status === 'failed' || status === 'interrupted'

export const reopen = (
  subagentId: string,
  controller: AbortController,
): SubagentRecord | null => {
  const record = subagents.get(subagentId)
  if (!record || !canReopen(record.status)) {
    return null
  }

  forgetBackgroundResultTracking(record.chatId, record.toolCallId)
  forgetResumeOverlayDelivery({
    chatId: record.chatId,
    toolCallId: record.toolCallId,
  })
  pendingBackgroundResume.add(record.chatId)
  if (
    backgroundSubagents.has(subagentId) ||
    restoredBackgroundSubagents.has(subagentId)
  ) {
    backgroundSubagents.add(subagentId)
  }
  markBlockingOriginReopened(subagentId)
  record.status = 'running'
  record.result = undefined
  controllers.set(subagentId, controller)
  bumpRevision()
  return record
}

const abortRunning = (subagentId: string, summary: string): boolean => {
  clearSteers(subagentId)
  const record = subagents.get(subagentId)
  if (!record || record.status !== 'running') {
    blockingSubagents.delete(subagentId)
    return false
  }

  controllers.get(subagentId)?.abort()
  controllers.delete(subagentId)
  blockingSubagents.delete(subagentId)
  forgetBlockingOriginSubagent(subagentId)
  const result: SubagentResult = { subagentId, name: record.agentName, summary }
  setSubagentStatus(record, 'aborted', result)
  resolveCompletionWaiters(subagentId, result)
  return true
}

export const abortOne = (subagentId: string): void => {
  if (abortRunning(subagentId, 'Stopped')) {
    bumpRevision()
  }
}

export const abortBlocking = (chatId: string): string[] => {
  const ids = chatSubagents.get(chatId)
  if (!ids) {
    return []
  }

  const abortedIds = [...ids].filter(
    (subagentId) =>
      blockingSubagents.has(subagentId) &&
      abortRunning(subagentId, 'Subagent aborted'),
  )
  if (abortedIds.length > 0) {
    bumpRevision()
  }
  return abortedIds
}

export const abort = (chatId: string): void => {
  const ids = chatSubagents.get(chatId)
  if (!ids) {
    if (pendingBackgroundResume.delete(chatId)) {
      bumpRevision()
    }
    return
  }

  for (const subagentId of ids) {
    abortRunning(subagentId, 'Subagent aborted')
    backgroundSubagents.delete(subagentId)
    restoredBackgroundSubagents.delete(subagentId)
    forgetBlockingOriginSubagent(subagentId)
  }

  chatSubagents.delete(chatId)
  turnResponseMessages.delete(chatId)
  pendingBackgroundResume.delete(chatId)
  forgetBackgroundResultTracking(chatId)
  bumpRevision()
}

export const resetSubagentRegistryForTests = (): void => {
  subagents.clear()
  chatSubagents.clear()
  controllers.clear()
  resetCompletionWaitersForTests()
  turnResponseMessages.clear()
  pendingBackgroundResume.clear()
  resetBackgroundResultSetsForTests()
  blockingSubagents.clear()
  backgroundSubagents.clear()
  restoredBackgroundSubagents.clear()
  resetBlockingOriginSetsForTests()
  resetInboxForTests()
  bumpRevision()
}
