import { toast } from 'vue-sonner'
import useAgentHarness from '@/composables/use-agent-harness'
import { consumePendingChatMessage } from '@/services/chat/pending-message'
import {
  clearAwaitingPlanGo,
  setSubagentModelLock,
} from '@/services/harness/plan-execution-session'
import { getUserHomeDir, updateChatMeta } from '@/services/vixl/vixl-tauri'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import { isReasoningLevel } from '@/types/models/reasoning-level'
import type { AgentThreadViewState } from './types'

export const createSessionOps = (state: AgentThreadViewState) => {
  const initHarness = (root: string, name: string): void => {
    if (!state.chatId.value) {
      state.harness.value = null
      return
    }
    const nextHarness = useAgentHarness({
      projectSlug: state.projectSlug.value,
      chatId: state.chatId.value,
      projectRoot: root,
      projectName: name,
      standalone: state.isStandalone.value,
    })
    state.harness.value = nextHarness
    nextHarness.setPermissionLevel(state.sessionPermissionLevel.value)
    nextHarness.restorePendingApprovals()
  }

  const flushPendingChatMessage = async (): Promise<void> => {
    if (state.isSubagentView.value) {
      return
    }
    if (!state.harness.value) {
      return
    }

    const pending = consumePendingChatMessage()
    if (!pending) {
      return
    }

    if (pending.permissionLevel) {
      state.permissionLevelTouched.value = true
      state.sessionPermissionLevel.value = pending.permissionLevel
      state.harness.value.setPermissionLevel(pending.permissionLevel)
    }

    if (pending.subagentModel) {
      const subagentReasoning = isReasoningLevel(pending.subagentReasoning)
        ? pending.subagentReasoning
        : null
      setSubagentModelLock(
        state.projectSlug.value,
        state.chatId.value,
        pending.subagentModel,
        subagentReasoning,
      )
      try {
        await updateChatMeta(state.projectSlug.value, state.chatId.value, {
          subagentModel: pending.subagentModel,
          subagentReasoning,
          reasoning: isReasoningLevel(pending.reasoning) ? pending.reasoning : null,
          awaitingPlanGo: null,
        })
      } catch (error) {
        toast.error('Failed to update chat for plan build', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    } else {
      clearAwaitingPlanGo(state.projectSlug.value, state.chatId.value)
    }

    await state.harness.value.send({
      text: pending.text,
      mode: pending.mode,
      model: pending.model,
      reasoning: isReasoningLevel(pending.reasoning) ? pending.reasoning : undefined,
      mentions: pending.mentions ?? state.contextBudgetSync.draftMentions.value,
      files: pending.files,
    })
    await state.fleetSidebar.refreshSlug(state.projectSlug.value)
  }

  const loadThread = async (): Promise<void> => {
    if (!state.chatId.value || !state.fleet.loaded.value) {
      return
    }
    if (!state.isStandalone.value && !state.projectSlug.value) {
      return
    }

    const nextThreadKey = state.threadKey.value
    if (state.loadedThreadKey.value === nextThreadKey && state.harness.value) {
      state.harness.value.restorePendingApprovals()
      await flushPendingChatMessage()
      return
    }

    if (!state.isStandalone.value && !state.project.value) {
      toast.error('Project not found', {
        description: `No project registered for slug "${state.projectSlug.value}"`,
      })
      return
    }

    const gen = ++state.loadGeneration.value
    const isStale = (): boolean => gen !== state.loadGeneration.value
    const slug = state.isStandalone.value ? HOME_CHAT_SLUG : state.projectSlug.value

    // Sync paint claim: leave chat A immediately; title/timeline/harness bind to B.
    const session = state.chatStore.selectChat(slug, state.chatId.value)
    state.paintedSession.value = session
    const alreadyWarm = state.chatStore.isSessionWarm(slug, state.chatId.value)
    state.threadReady.value = alreadyWarm

    if (state.isStandalone.value) {
      if (state.homeRoot.value) {
        initHarness(state.homeRoot.value, 'Home')
      } else {
        state.harness.value = null
      }
    } else if (state.project.value) {
      initHarness(state.project.value.rootPath, state.project.value.name)
    }

    // Resolve home root if needed (timeline already paints without it).
    if (state.isStandalone.value && !state.homeRoot.value) {
      state.homeRoot.value = await getUserHomeDir()
      if (isStale()) {
        return
      }
      initHarness(state.homeRoot.value, 'Home')
    }

    const hydratePath = await state.chatStore.ensureChatHydrated(slug, state.chatId.value)
    if (isStale()) {
      return
    }

    // Idle warm: soft meta refresh in the background, never blocks paint.
    if (hydratePath === 'warmIdle') {
      state.chatStore.refreshChatMeta(slug, state.chatId.value).catch((error) => {
        toast.error('Failed to refresh chat', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }

    state.loadedThreadKey.value = nextThreadKey
    state.threadReady.value = true

    // Deferred: project activation, sidebar list, budget, pending flush.
    if (!state.isStandalone.value && state.project.value) {
      const targetProject = state.project.value
      if (state.fleet.activeProjectId.value !== targetProject.id) {
        await state.fleet.setActiveProject(targetProject.id)
        if (isStale()) {
          return
        }
      }
    }

    state.fleetSidebar.refreshSlug(state.projectSlug.value).catch((error) => {
      toast.error('Failed to refresh chat list', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    })

    state.contextBudgetSync.refreshContextBudget().catch((error) => {
      toast.error('Failed to refresh context usage', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    })

    await flushPendingChatMessage()
  }

  return {
    initHarness,
    flushPendingChatMessage,
    loadThread,
  }
}

export type AgentThreadSessionOps = ReturnType<typeof createSessionOps>
