import type { AgentShellRecord } from '@/types/harness/agent-shell'
import {
  clearPendingShellResumeState,
  listDeliverableShellResults,
  parentBackgroundShellsAreRunning,
} from './shell-wake-queue'

export const trackShellForChat = (
  chatShells: Map<string, Set<string>>,
  chatId: string,
  shellId: string,
): void => {
  const existing = chatShells.get(chatId) ?? new Set<string>()
  existing.add(shellId)
  chatShells.set(chatId, existing)
}

const remainingShellsForChat = (
  chatId: string,
  shells: Map<string, AgentShellRecord>,
  chatShells: Map<string, Set<string>>,
): AgentShellRecord[] => {
  const remaining: AgentShellRecord[] = []
  for (const id of chatShells.get(chatId) ?? []) {
    const shell = shells.get(id)
    if (shell) {
      remaining.push(shell)
    }
  }
  return remaining
}

export default (
  shellId: string,
  chatId: string,
  shells: Map<string, AgentShellRecord>,
  chatShells: Map<string, Set<string>>,
  cleanupShellListeners: (id: string) => void,
  bumpRevision: () => void,
): void => {
  shells.delete(shellId)
  const tracked = chatShells.get(chatId)
  if (tracked) {
    tracked.delete(shellId)
    if (tracked.size === 0) {
      chatShells.delete(chatId)
    }
  }
  cleanupShellListeners(shellId)
  if (
    !parentBackgroundShellsAreRunning(
      remainingShellsForChat(chatId, shells, chatShells),
    ) &&
    listDeliverableShellResults(chatId).length === 0
  ) {
    clearPendingShellResumeState(chatId)
  }
  bumpRevision()
}
