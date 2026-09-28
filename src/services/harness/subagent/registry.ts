import type { ModelMessage } from 'ai'
import { ref } from 'vue'
import type { SubagentRecord, SubagentResult, SubagentStatus } from '@/types/harness/subagent-record'
import { clearSteers, resetInboxForTests } from '@/services/harness/subagent/inbox'

type CompletionWaiter = (result: SubagentResult) => void

const subagents = new Map<string, SubagentRecord>()
const chatSubagents = new Map<string, Set<string>>()
const controllers = new Map<string, AbortController>()
const completionWaiters = new Map<string, CompletionWaiter[]>()
const turnResponseMessages = new Map<string, ModelMessage[]>()
const pendingBackgroundResume = new Set<string>()
const deliveredBackgroundResults = new Map<string, Set<string>>()

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

const resolveCompletionWaiters = (subagentId: string, result: SubagentResult): void => {
  const waiters = completionWaiters.get(subagentId) ?? []
  completionWaiters.delete(subagentId)
  for (const resolve of waiters) {
    resolve(result)
  }
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
  }

  subagents.set(subagentId, record)
  controllers.set(subagentId, controller)
  trackSubagentForChat(chatId, subagentId)
  if (options?.pendingResume !== false) {
    pendingBackgroundResume.add(chatId)
  }
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
  resolveCompletionWaiters(subagentId, result)
  bumpRevision()
}

export const fail = (subagentId: string, summary: string): void => {
  const record = subagents.get(subagentId)
  if (!record || record.status !== 'running') {
    return
  }

  const result: SubagentResult = {
    subagentId,
    name: record.agentName,
    summary,
  }
  setSubagentStatus(record, 'failed', result)
  controllers.delete(subagentId)
  resolveCompletionWaiters(subagentId, result)
  bumpRevision()
}

export const waitFor = (chatId: string, subagentId: string): Promise<SubagentResult> => {
  const record = subagents.get(subagentId)
  if (!record || record.chatId !== chatId) {
    return Promise.reject(new Error(`Subagent not found: ${subagentId}`))
  }

  if (record.status !== 'running' && record.result) {
    return Promise.resolve(record.result)
  }

  return new Promise((resolvePromise) => {
    const waiters = completionWaiters.get(subagentId) ?? []
    waiters.push(resolvePromise)
    completionWaiters.set(subagentId, waiters)
  })
}

export const getSubagent = (subagentId: string): SubagentRecord | null =>
  subagents.get(subagentId) ?? null

export const hasSubagent = (subagentId: string): boolean => subagents.has(subagentId)

export const listSubagentsForChat = (chatId: string): SubagentRecord[] => {
  const ids = chatSubagents.get(chatId)
  if (!ids) {
    return []
  }

  return [...ids]
    .map((subagentId) => subagents.get(subagentId))
    .filter((record): record is SubagentRecord => record !== undefined)
}

export const hasRunningSubagentsForChat = (chatId: string): boolean =>
  listSubagentsForChat(chatId).some((record) => record.status === 'running')

export const getRunningSubagentForChat = (chatId: string): SubagentRecord | null =>
  listSubagentsForChat(chatId).find((record) => record.status === 'running') ?? null

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
): Array<{ toolCallId: string; result: SubagentResult }> => {
  const delivered = deliveredBackgroundResults.get(chatId)
  return listSubagentsForChat(chatId).flatMap((record) => {
    if (
      (record.status !== 'completed' && record.status !== 'failed') ||
      !record.result ||
      delivered?.has(record.toolCallId)
    ) {
      return []
    }
    return [{ toolCallId: record.toolCallId, result: record.result }]
  })
}

export const markBackgroundResultsDelivered = (
  chatId: string,
  toolCallIds: string[],
): void => {
  if (toolCallIds.length === 0) {
    return
  }
  const existing = deliveredBackgroundResults.get(chatId) ?? new Set<string>()
  for (const toolCallId of toolCallIds) {
    existing.add(toolCallId)
  }
  deliveredBackgroundResults.set(chatId, existing)
}

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

export const appendMessages = (
  subagentId: string,
  extra: ModelMessage[],
): void => {
  const record = subagents.get(subagentId)
  if (!record || extra.length === 0) {
    return
  }
  record.messages = [...(record.messages ?? []), ...extra]
}

export const reopen = (
  subagentId: string,
  controller: AbortController,
): SubagentRecord | null => {
  const record = subagents.get(subagentId)
  if (!record || (record.status !== 'completed' && record.status !== 'failed')) {
    return null
  }

  deliveredBackgroundResults.get(record.chatId)?.delete(record.toolCallId)
  pendingBackgroundResume.add(record.chatId)
  record.status = 'running'
  record.result = undefined
  controllers.set(subagentId, controller)
  bumpRevision()
  return record
}

export const abortOne = (subagentId: string): void => {
  clearSteers(subagentId)
  const record = subagents.get(subagentId)
  if (!record || record.status !== 'running') {
    return
  }

  const controller = controllers.get(subagentId)
  controller?.abort()
  controllers.delete(subagentId)

  const result: SubagentResult = {
    subagentId,
    name: record.agentName,
    summary: 'Stopped',
  }
  setSubagentStatus(record, 'aborted', result)
  resolveCompletionWaiters(subagentId, result)
  bumpRevision()
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
    clearSteers(subagentId)
    const record = subagents.get(subagentId)
    if (!record || record.status !== 'running') {
      continue
    }

    const controller = controllers.get(subagentId)
    controller?.abort()
    controllers.delete(subagentId)

    const result: SubagentResult = {
      subagentId,
      name: record.agentName,
      summary: 'Subagent aborted',
    }
    setSubagentStatus(record, 'aborted', result)
    resolveCompletionWaiters(subagentId, result)
  }

  chatSubagents.delete(chatId)
  turnResponseMessages.delete(chatId)
  pendingBackgroundResume.delete(chatId)
  deliveredBackgroundResults.delete(chatId)
  bumpRevision()
}

export const resetSubagentRegistryForTests = (): void => {
  subagents.clear()
  chatSubagents.clear()
  controllers.clear()
  completionWaiters.clear()
  turnResponseMessages.clear()
  pendingBackgroundResume.clear()
  deliveredBackgroundResults.clear()
  resetInboxForTests()
  bumpRevision()
}
