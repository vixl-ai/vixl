import { toast } from 'vue-sonner'
import type { ChatAttention } from '@/types/chat/chat-attention'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import {
  hasPendingBackgroundResume,
  hasRunningSubagentsForChat,
} from '@/services/harness/subagent/registry'
import type { AgentHarnessState, AttentionHelpers } from './types'

export const makeHarnessKey = (projectSlug: string, chatId: string): string =>
  `${projectSlug}::${chatId}`

export default (state: AgentHarnessState): AttentionHelpers => {
  const { options, session, status, pendingApprovals, pendingMcpAuth, fleetSidebar, chatStore } =
    state

  const isParentBusy = (): boolean =>
    status.value === 'streaming' ||
    status.value === 'submitted' ||
    state.resumingBackgroundBatch.value ||
    state.compacting.value

  const isWaitingOnBackground = (): boolean =>
    hasPendingBackgroundResume(options.chatId) ||
    hasRunningSubagentsForChat(options.chatId)

  const isFullyIdle = (): boolean => !isParentBusy() && !isWaitingOnBackground()

  const refreshSidebar = (): void => {
    fleetSidebar.refreshSlug(options.projectSlug).catch((err) => {
      toast.error('Failed to refresh sidebar', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    })
  }

  const setChatAttention = (attention: ChatAttention): void => {
    updateChatMeta(options.projectSlug, options.chatId, { attention })
      .then(() => {
        session.patchMeta({ attention })
        refreshSidebar()
      })
      .catch((err) => {
        toast.error('Failed to update chat attention', {
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      })
  }

  const maybeClearAttentionWhenGatesEmpty = (): void => {
    if (pendingApprovals.value.length > 0) {
      return
    }
    if (pendingMcpAuth.value.length > 0) {
      return
    }
    if (session.pendingQuestion.value) {
      return
    }
    setChatAttention(null)
  }

  const applyTurnEndAttention = (outcome: 'success' | 'error'): void => {
    const active = chatStore.isSessionActive(options.projectSlug, options.chatId)
    if (outcome === 'success') {
      setChatAttention(active ? null : 'completed')
      return
    }
    if (!active) {
      setChatAttention('error')
    }
  }

  return {
    refreshSidebar,
    setChatAttention,
    maybeClearAttentionWhenGatesEmpty,
    applyTurnEndAttention,
    isParentBusy,
    isWaitingOnBackground,
    isFullyIdle,
  }
}
