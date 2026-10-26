import { getSubagent } from '@/services/harness/subagent/registry'
import type { AgentShellRecord, ShellWakeResult } from '@/types/harness/agent-shell'
import type { ShellExitResult } from '@/types/harness/shell-exit'
import { clipTerminalOutput } from '@/utils/clip-terminal-output'

const pendingShellResume = new Set<string>()
const deliveredShellResults = new Map<string, Set<string>>()
const queuedShellResults = new Map<string, ShellWakeResult[]>()

export const markPendingShellResume = (chatId: string): void => {
  pendingShellResume.add(chatId)
}

const shouldQueueDeliverableShellResult = (
  shell: AgentShellRecord,
  hasExitWaiters: boolean,
): string | null => {
  if (!shell.wakeParent || hasExitWaiters) {
    return null
  }
  const toolCallId = shell.toolCallId
  if (!toolCallId) {
    return null
  }
  if (shell.subagentId) {
    const owner = getSubagent(shell.subagentId)
    if (owner?.status === 'running') {
      return null
    }
  }
  return toolCallId
}

export const enqueueDeliverableShellResult = (
  shell: AgentShellRecord,
  exit: ShellExitResult,
  hasExitWaiters: boolean,
): void => {
  const toolCallId = shouldQueueDeliverableShellResult(shell, hasExitWaiters)
  if (!toolCallId) {
    return
  }
  const result: ShellWakeResult = {
    toolCallId,
    shellId: shell.shellId,
    command: shell.command,
    ...(shell.description ? { description: shell.description } : {}),
    exitCode: exit.exitCode,
    ...(exit.signal != null ? { signal: exit.signal } : {}),
    stdout: clipTerminalOutput(shell.stdout),
    stderr: clipTerminalOutput(shell.stderr),
  }
  const queued = queuedShellResults.get(shell.chatId) ?? []
  queued.push(result)
  queuedShellResults.set(shell.chatId, queued)
}

export const listDeliverableShellResults = (chatId: string): ShellWakeResult[] => {
  const delivered = deliveredShellResults.get(chatId)
  const queued = queuedShellResults.get(chatId) ?? []
  if (!delivered || delivered.size === 0) {
    return [...queued]
  }
  return queued.filter((result) => !delivered.has(result.toolCallId))
}

export const markShellResultsDelivered = (chatId: string, toolCallIds: string[]): void => {
  if (toolCallIds.length === 0) {
    return
  }
  const existing = deliveredShellResults.get(chatId) ?? new Set<string>()
  for (const toolCallId of toolCallIds) {
    existing.add(toolCallId)
  }
  deliveredShellResults.set(chatId, existing)
}

export const hasPendingShellResume = (chatId: string): boolean =>
  pendingShellResume.has(chatId)

export const clearPendingShellResumeState = (chatId: string): boolean =>
  pendingShellResume.delete(chatId)

export const parentBackgroundShellsAreRunning = (
  shells: Array<Pick<AgentShellRecord, 'status' | 'background' | 'subagentId'>>,
): boolean =>
  shells.some(
    (shell) =>
      shell.status === 'running' && shell.background === true && !shell.subagentId,
  )

export const discardShellWakeQueueForChat = (chatId: string): boolean => {
  const hadPending = pendingShellResume.delete(chatId)
  const hadQueued = queuedShellResults.delete(chatId)
  deliveredShellResults.delete(chatId)
  return hadPending || hadQueued
}

export const resetShellWakeQueueForTests = (): void => {
  pendingShellResume.clear()
  deliveredShellResults.clear()
  queuedShellResults.clear()
}
