import {
  clearPendingShellResume,
  hasPendingShellResume,
  hasRunningParentBackgroundShells,
  listDeliverableShellResults,
  markShellResultsDelivered,
} from '@/services/harness/shell/registry'
import flushPendingBackgroundResume from '@/services/harness/subagent/flush-pending-resume'
import {
  clearPendingBackgroundResume,
  getSubagent,
  hasPendingBackgroundResume,
  hasRunningSubagentsForChat,
  listDeliverableBackgroundResults,
  markBackgroundResultsDelivered,
} from '@/services/harness/subagent/registry'
import type { ShellWakeResult } from '@/types/harness/agent-shell'
import type { SubagentResult } from '@/types/harness/subagent-record'

export type PrefinishedBackgroundResult = {
  toolCallId: string
  result: SubagentResult
}

const collectPrefinishedBackgroundResults = (
  chatId: string,
  internal: boolean | undefined,
  resumingBackgroundBatch: boolean,
): PrefinishedBackgroundResult[] | undefined => {
  if (internal || resumingBackgroundBatch || !hasPendingBackgroundResume(chatId)) {
    return undefined
  }

  const deliverable = listDeliverableBackgroundResults(chatId)
  const snapshot = deliverable.length > 0 ? deliverable : undefined
  flushPendingBackgroundResume(chatId, { markDelivered: false })
  return snapshot
}

export const commitPrefinishedBackgroundResults = (
  chatId: string,
  results: PrefinishedBackgroundResult[] | undefined,
): void => {
  if (!results || results.length === 0) {
    return
  }

  // Object identity: reopen() clears result, then resolve/fail assigns a new
  // object on the same toolCallId. Mark delivered only when this turn still
  // holds the snapshotted outcome so a steered finish stays wakeable.
  const deliveredToolCallIds = results.flatMap((item) => {
    const record = getSubagent(item.result.subagentId)
    if (record?.toolCallId !== item.toolCallId || record.result !== item.result) {
      return []
    }
    return [item.toolCallId]
  })
  markBackgroundResultsDelivered(chatId, deliveredToolCallIds)
  if (
    !hasRunningSubagentsForChat(chatId) &&
    listDeliverableBackgroundResults(chatId).length === 0
  ) {
    clearPendingBackgroundResume(chatId)
  }
}

export const collectPrefinishedShellResults = (
  chatId: string,
  internal: boolean | undefined,
  resumingBackgroundBatch: boolean,
): ShellWakeResult[] | undefined => {
  if (internal || resumingBackgroundBatch) {
    return undefined
  }
  if (
    !hasPendingShellResume(chatId) &&
    listDeliverableShellResults(chatId).length === 0
  ) {
    return undefined
  }

  return listDeliverableShellResults(chatId)
}

export const commitPrefinishedShellResults = (
  chatId: string,
  results: ShellWakeResult[] | undefined,
): void => {
  if (!results || results.length === 0) {
    return
  }

  const deliverable = listDeliverableShellResults(chatId)
  const deliveredToolCallIds = results.flatMap((item) => {
    const live = deliverable.find((entry) => entry.toolCallId === item.toolCallId)
    if (!live || live.shellId !== item.shellId || live.exitCode !== item.exitCode) {
      return []
    }
    return [item.toolCallId]
  })
  markShellResultsDelivered(chatId, deliveredToolCallIds)
  if (
    !hasRunningParentBackgroundShells(chatId) &&
    listDeliverableShellResults(chatId).length === 0
  ) {
    clearPendingShellResume(chatId)
  }
}

export default collectPrefinishedBackgroundResults
