import { onMounted, onUnmounted, watch } from 'vue'
import { toast } from 'vue-sonner'
import { PENDING_CHAT_MESSAGE_EVENT } from '@/services/chat/pending-message'
import { loadEffectiveSettings } from '@/services/config/vixl-config'
import type { AgentThreadHandlers } from './handlers'
import type { AgentThreadSessionOps } from './session'
import type { AgentThreadViewState } from './types'
import syncContextActions from './context-actions-sync'
import {
  cachedHarnessPermissionLevel,
  metaPermissionLevelForChat,
  noteSettingsPermissionSeed,
  settingsMayApplyPermissionLevel,
  settingsPermissionSeedLevel,
  writeSettingsPermissionLevel,
} from './permission-level'

export const bindAgentThreadLifecycle = (
  state: AgentThreadViewState,
  session: AgentThreadSessionOps,
  handlers: AgentThreadHandlers,
): void => {
  watch(
    [
      state.threadReady,
      state.isSubagentView,
      () => state.harness.value?.compacting.value ?? false,
      () => state.harness.value?.status.value,
    ],
    () => {
      syncContextActions(state, handlers)
    },
    { immediate: true },
  )

  const thisChatPermissionSources = () => {
    const chatId = state.chatId.value
    const slug = state.projectSlug.value
    return {
      touched: state.permissionLevelTouched.value,
      cachedLevel: cachedHarnessPermissionLevel(slug, chatId),
      metaLevel:
        metaPermissionLevelForChat(state.paintedSession.value?.meta.value, chatId) ??
        metaPermissionLevelForChat(state.chatStore.meta.value, chatId),
      seededLevel: settingsPermissionSeedLevel(state, slug, chatId),
    }
  }

  watch(
    [
      () => state.config.hydrated.value,
      state.isStandalone,
      () => state.chatStore.meta.value?.projectRoot ?? null,
      () => state.project.value?.rootPath ?? null,
    ],
    async ([hydrated]) => {
      if (!hydrated || !settingsMayApplyPermissionLevel(thisChatPermissionSources())) {
        return
      }
      const chatId = state.chatId.value
      const slug = state.projectSlug.value
      const root = state.isStandalone.value
        ? null
        : (state.chatStore.meta.value?.projectRoot?.trim()
          || state.project.value?.rootPath
          || null)
      try {
        const settings = await loadEffectiveSettings(root)
        if (state.chatId.value !== chatId || state.projectSlug.value !== slug) {
          return
        }
        if (!settingsMayApplyPermissionLevel(thisChatPermissionSources())) {
          return
        }
        const next = settings['agent.permissionLevel'] ?? 'allowlist'
        const seededLevel = settingsPermissionSeedLevel(state, slug, chatId)
        state.sessionPermissionLevel.value = next
        noteSettingsPermissionSeed(state, slug, chatId, next)
        writeSettingsPermissionLevel(slug, chatId, next, seededLevel)
      } catch (error) {
        toast.error('Failed to load project settings', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    { immediate: true },
  )

  let removePendingListener: (() => void) | null = null

  onMounted(() => {
    const handlePendingMessageEvent = (): void => {
      session.flushPendingChatMessage().catch((error) => {
        toast.error('Failed to start plan build', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }
    window.addEventListener(PENDING_CHAT_MESSAGE_EVENT, handlePendingMessageEvent)
    removePendingListener = () => {
      window.removeEventListener(PENDING_CHAT_MESSAGE_EVENT, handlePendingMessageEvent)
    }

    session.loadThread().catch((error) => {
      toast.error('Failed to load chat', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    })
  })

  onUnmounted(() => {
    removePendingListener?.()
    removePendingListener = null
    state.contextActions.clear()
  })

  watch(
    [state.projectSlug, state.chatId, () => state.fleet.loaded.value, state.isStandalone],
    () => {
      session.loadThread().catch((error) => {
        toast.error('Failed to load chat', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    },
  )
}
