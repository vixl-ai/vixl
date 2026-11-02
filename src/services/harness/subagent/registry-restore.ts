import type { SubagentRecord } from '@/types/harness/subagent-record'
import {
  classifySubagentOrigin,
  forgetBlockingOriginSubagent,
  listDeliverableResults,
} from '@/services/harness/subagent/blocking-origin-sets'
import { clearSteers } from '@/services/harness/subagent/inbox'
import { resolveCompletionWaiters } from '@/services/harness/subagent/registry-completion'

export type SubagentRegistryMaps = {
  subagents: Map<string, SubagentRecord>
  chatSubagents: Map<string, Set<string>>
  controllers: Map<string, AbortController>
  blockingSubagents: Set<string>
  backgroundSubagents: Set<string>
  restoredBackgroundSubagents: Set<string>
  pendingBackgroundResume: Set<string>
}

type RestoreHooks = {
  trackSubagentForChat: (chatId: string, subagentId: string) => void
  bumpRevision: () => void
}

const untrackSubagentForChat = (
  chatSubagents: Map<string, Set<string>>,
  chatId: string,
  subagentId: string,
): void => {
  const ids = chatSubagents.get(chatId)
  if (!ids) {
    return
  }
  ids.delete(subagentId)
  if (ids.size === 0) {
    chatSubagents.delete(chatId)
  }
}

const clearSubagentMembership = (maps: SubagentRegistryMaps, subagentId: string): void => {
  maps.backgroundSubagents.delete(subagentId)
  maps.restoredBackgroundSubagents.delete(subagentId)
  maps.blockingSubagents.delete(subagentId)
}

const dropSubagentRecord = (
  maps: SubagentRegistryMaps,
  chatId: string,
  subagentId: string,
): void => {
  const record = maps.subagents.get(subagentId)
  if (record && record.chatId !== chatId) {
    untrackSubagentForChat(maps.chatSubagents, chatId, subagentId)
    return
  }
  clearSteers(subagentId)
  if (record?.status === 'running') {
    maps.controllers.get(subagentId)?.abort()
    resolveCompletionWaiters(subagentId, {
      subagentId,
      name: record.agentName,
      summary: 'Subagent aborted',
    })
  }
  maps.controllers.delete(subagentId)
  maps.subagents.delete(subagentId)
  untrackSubagentForChat(maps.chatSubagents, chatId, subagentId)
  clearSubagentMembership(maps, subagentId)
  forgetBlockingOriginSubagent(subagentId)
}

export const restoreSubagentRecord = (
  maps: SubagentRegistryMaps,
  record: SubagentRecord,
  options: { background?: boolean } | undefined,
  hooks: RestoreHooks,
): SubagentRecord | null => {
  const existing = maps.subagents.get(record.subagentId)
  if (existing?.status === 'running') {
    return null
  }
  if (existing && existing.chatId !== record.chatId) {
    untrackSubagentForChat(maps.chatSubagents, existing.chatId, record.subagentId)
    clearSubagentMembership(maps, record.subagentId)
    forgetBlockingOriginSubagent(record.subagentId)
  }
  const next: SubagentRecord = {
    ...record,
    startedAt: record.startedAt || existing?.startedAt || new Date().toISOString(),
  }
  maps.subagents.set(next.subagentId, next)
  hooks.trackSubagentForChat(next.chatId, next.subagentId)
  if (options?.background) {
    maps.restoredBackgroundSubagents.add(next.subagentId)
  } else {
    maps.restoredBackgroundSubagents.delete(next.subagentId)
  }
  classifySubagentOrigin(next.subagentId, options?.background !== true)
  hooks.bumpRevision()
  return next
}

export const pruneChatSubagentIds = (
  maps: SubagentRegistryMaps,
  chatId: string,
  keptSubagentIds: ReadonlySet<string>,
  bumpRevision: () => void,
): void => {
  const ids = maps.chatSubagents.get(chatId)
  if (!ids) {
    return
  }
  const dropped = [...ids].filter((id) => !keptSubagentIds.has(id))
  if (dropped.length === 0) {
    return
  }
  for (const subagentId of dropped) {
    dropSubagentRecord(maps, chatId, subagentId)
  }
  const remaining = [...(maps.chatSubagents.get(chatId) ?? [])]
    .map((id) => maps.subagents.get(id))
    .filter((record): record is SubagentRecord => record !== undefined)
  const hasRunning = remaining.some((record) => record.status === 'running')
  const hasDeliverable =
    listDeliverableResults(chatId, remaining, (id) =>
      maps.backgroundSubagents.has(id),
    ).length > 0
  if (!hasRunning && !hasDeliverable) {
    maps.pendingBackgroundResume.delete(chatId)
  }
  bumpRevision()
}
