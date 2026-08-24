import { toast } from 'vue-sonner'
import {
  abort as abortSubagentsForChat,
  abortOne,
  clearPendingBackgroundResume,
} from '@/services/harness/subagent/registry'
import { releaseLocksForChat } from '@/services/browser/registry'
import { killShellsForChat } from '@/services/harness/shell/registry'
import { rejectPendingMcpAuthForChat } from '@/services/mcp/mcp-auth-gate'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import type { QueuedChatMessage } from '@/types/chat/queued-chat-message'
import type { SendArgs } from './send'
import type { AgentHarnessState, AttentionHelpers } from './types'

type LifecycleDeps = {
  send: (args: SendArgs) => Promise<void>
  stopMcpAuthPolling: () => void
  maybeFlushBackgroundSubagentResume: () => void
}

export default (
  state: AgentHarnessState,
  attention: AttentionHelpers,
  deps: LifecycleDeps,
) => {
  const {
    options,
    session,
    status,
    subagents,
    abortController,
    pendingMcpAuth,
    messageQueue,
  } = state

  const stopSubagent = (subagentId: string): void => {
    abortOne(subagentId)
    session.completeLocalSubagent(subagentId, 'Stopped', 'stopped')
    subagents.value = subagents.value.map((item) =>
      item.subagentId === subagentId
        ? { ...item, status: 'stopped', summary: 'Stopped' }
        : item,
    )
    deps.maybeFlushBackgroundSubagentResume()
  }

  const stop = async (): Promise<void> => {
    abortController.value?.abort()
    releaseLocksForChat(options.chatId, 'aborted')
    rejectPendingMcpAuthForChat(options.chatId)
    pendingMcpAuth.value = []
    deps.stopMcpAuthPolling()
    abortSubagentsForChat(options.chatId)
    const runningIds = new Set(
      subagents.value
        .filter((item) => item.status === 'running')
        .map((item) => item.subagentId),
    )
    for (const subagentId of runningIds) {
      session.completeLocalSubagent(subagentId, 'Stopped', 'stopped')
    }
    if (runningIds.size > 0) {
      subagents.value = subagents.value.map((item) =>
        runningIds.has(item.subagentId)
          ? { ...item, status: 'stopped', summary: 'Stopped' }
          : item,
      )
    }
    status.value = 'ready'
    session.finishAgentTurn()
    try {
      await updateChatMeta(options.projectSlug, options.chatId, {
        status: 'idle',
      })
      session.patchMeta({ status: 'idle' })
      attention.refreshSidebar()
    } catch (metaError) {
      toast.error('Failed to update chat status', {
        description:
          metaError instanceof Error ? metaError.message : 'Unknown error',
      })
    }
    try {
      await killShellsForChat(options.chatId)
    } catch (stopError) {
      toast.error('Failed to stop terminals', {
        description: stopError instanceof Error ? stopError.message : 'Unknown error',
      })
    }
  }

  const forceSendQueued = async (id: string): Promise<void> => {
    const item = messageQueue.items.value.find((entry) => entry.id === id)
    if (!item) {
      return
    }
    messageQueue.remove(id)
    await stop()
    clearPendingBackgroundResume(options.chatId)
    try {
      await deps.send({
        text: item.text,
        files: item.files,
        mode: item.mode,
        model: item.model,
        reasoning: item.reasoning,
        mentions: item.mentions,
        internal: true,
      })
    } catch (err) {
      toast.error('Failed to send queued message', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const cancelQueued = (id: string): void => {
    messageQueue.remove(id)
  }

  // Returns the queued item read-only. The view/composer slice is responsible
  // for hydrating the composer from this item and then calling cancelQueued
  // to remove it, so this slice never mutates the queue on edit.
  const editQueued = (id: string): QueuedChatMessage | undefined =>
    messageQueue.items.value.find((entry) => entry.id === id)

  const dispose = async (): Promise<void> => {
    await stop()
    messageQueue.clear()
  }

  return {
    stop,
    stopSubagent,
    forceSendQueued,
    cancelQueued,
    editQueued,
    dispose,
  }
}
