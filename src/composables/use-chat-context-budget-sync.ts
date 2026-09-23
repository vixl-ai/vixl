import { effectScope, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { ContextMention } from '@/types/harness/context-mention'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import { getFrozenPrefix } from '@/services/harness/prefix-contract'
import { normalizeStoredModelRef } from '@/schemas/vixl-settings'
import useChatStore from '@/composables/use-chat-store'
import useContextUsage from '@/composables/use-context-usage'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useVixlConfig from '@/composables/use-vixl-config'
import useMcpServers from '@/composables/use-mcp-servers'

const draftModelRef = ref('')
const draftMode = ref<VixlChatMode>('agent')
const draftMentions = ref<ContextMention[]>([])

export const CONTEXT_BUDGET_STREAM_DEBOUNCE_MS = 500

let watchStarted = false
let stopBudgetWatch: (() => void) | null = null
let refreshImpl: (() => Promise<void>) | null = null
let scheduledTimer: ReturnType<typeof setTimeout> | null = null
let scheduledMode: 'prompt' | 'stream' | null = null
let refreshRunning = false
let refreshQueued = false

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopBudgetWatch?.()
    stopBudgetWatch = null
    watchStarted = false
    refreshImpl = null
  })
}

const mcpStatusKey = (states: Record<string, { status: string; tools: unknown[] }>): string =>
  Object.keys(states)
    .sort()
    .map((id) => {
      const state = states[id]
      if (!state) {
        return `${id}:missing:0`
      }
      return `${id}:${state.status}:${state.tools.length}`
    })
    .join('|')

const lastTurnToolStatusKey = (timeline: ChatTimelineItem[]): string => {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index]
    if (item?.type !== 'agent-turn') {
      continue
    }
    return item.turn.steps
      .flatMap((step) => step.tools)
      .map((tool) => `${tool.toolCallId}:${tool.status}`)
      .join('|')
  }
  return ''
}

const clearScheduledRefresh = (): void => {
  if (scheduledTimer !== null) {
    clearTimeout(scheduledTimer)
    scheduledTimer = null
  }
  scheduledMode = null
}

const enqueueRefresh = (): Promise<void> => {
  refreshQueued = true
  if (refreshRunning) {
    return Promise.resolve()
  }
  clearScheduledRefresh()
  refreshRunning = true
  return (async () => {
    try {
      do {
        refreshQueued = false
        const refresh = refreshImpl
        if (!refresh) {
          return
        }
        await refresh()
      } while (refreshQueued)
    } finally {
      refreshRunning = false
    }
  })()
}

const runScheduledRefresh = (): void => {
  scheduledTimer = null
  scheduledMode = null
  enqueueRefresh().catch((error: unknown) => {
    toast.error('Failed to refresh context usage', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  })
}

const scheduleRefresh = (mode: 'prompt' | 'stream'): void => {
  if (mode === 'prompt') {
    if (scheduledMode === 'prompt') {
      return
    }
    clearScheduledRefresh()
    scheduledMode = 'prompt'
    scheduledTimer = setTimeout(runScheduledRefresh, 0)
    return
  }
  if (scheduledMode === 'prompt') {
    return
  }
  clearScheduledRefresh()
  scheduledMode = 'stream'
  scheduledTimer = setTimeout(
    runScheduledRefresh,
    CONTEXT_BUDGET_STREAM_DEBOUNCE_MS,
  )
}

export default () => {
  const chatStore = useChatStore()
  const contextUsage = useContextUsage()
  const fleet = useFleetRegistry()
  const config = useVixlConfig()
  const mcp = useMcpServers()

  const setDraftSelection = (model: string, mode: VixlChatMode): void => {
    if (model) {
      draftModelRef.value = model
    }
    draftMode.value = mode
  }

  const setDraftMentions = (mentions: ContextMention[]): void => {
    draftMentions.value = mentions
  }

  const refreshContextBudget = async (): Promise<void> => {
    const meta = chatStore.meta.value
    const selectedChatId = chatStore.chatId.value ?? meta?.id ?? null

    if (chatStore.loading.value) {
      if (selectedChatId) {
        contextUsage.bindChat(selectedChatId)
      }
      return
    }

    if (!selectedChatId) {
      contextUsage.bindChat(null)
      return
    }

    if (!meta) {
      return
    }

    const modelId =
      draftModelRef.value ||
      (meta.model ? normalizeStoredModelRef(meta.model) ?? meta.model : '') ||
      ''
    if (!modelId) {
      contextUsage.bindChat(selectedChatId)
      return
    }

    const mode = draftMode.value || meta.mode || 'agent'
    const project = fleet.activeProject.value
    const standalone = meta.projectSlug === HOME_CHAT_SLUG
    const projectRoot = standalone
      ? meta.projectRoot
      : project?.rootPath ?? meta.projectRoot
    if (!projectRoot) {
      contextUsage.bindChat(selectedChatId)
      return
    }

    const projectName = standalone
      ? 'Home'
      : project?.name ?? meta.projectSlug ?? 'Home'

    const frozenSnapshot = getFrozenPrefix(meta)
    const timeline = chatStore.timeline.value
    const messages = chatStore.messages.value

    await contextUsage.refresh({
      modelId,
      mode,
      projectName,
      projectRoot,
      messages,
      timeline,
      settings: config.effectiveSettings.value,
      standalone,
      frozenSnapshot,
      mentions: draftMentions.value,
      activeContext: meta.activeContext ?? null,
      chatId: selectedChatId,
    })
  }

  refreshImpl = refreshContextBudget

  if (!watchStarted) {
    watchStarted = true
    const scope = effectScope(true)
    stopBudgetWatch = () => {
      clearScheduledRefresh()
      refreshQueued = false
      scope.stop()
    }
    scope.run(() => {
      watch(
        [
          draftModelRef,
          draftMode,
          draftMentions,
          () => chatStore.loading.value,
          () => chatStore.messages.value.length,
          () => fleet.activeProject.value?.id,
          () => chatStore.meta.value?.model,
          () => chatStore.meta.value?.mode,
          () => chatStore.meta.value?.prefixSnapshot?.hash,
          () => chatStore.chatId.value,
          () => chatStore.meta.value?.id,
          () => chatStore.meta.value?.activeContext?.includeFromCreatedAt,
          () => chatStore.meta.value?.activeContext?.summary,
          () => mcpStatusKey(mcp.serverStates.value),
          () => config.effectiveSettings.value['models.catalogOptions'],
          () => config.effectiveSettings.value['models.catalogMeta'],
          () => chatStore.activeTurnId.value,
          () => chatStore.activeStepId.value,
          () => lastTurnToolStatusKey(chatStore.timeline.value),
        ],
        () => {
          scheduleRefresh('prompt')
        },
        { immediate: true },
      )
      watch(
        () => chatStore.timeline.value,
        () => {
          if (chatStore.activeTurnId.value) {
            scheduleRefresh('stream')
          } else {
            scheduleRefresh('prompt')
          }
        },
      )
    })
  }

  return {
    draftModelRef,
    draftMode,
    draftMentions,
    setDraftSelection,
    setDraftMentions,
    refreshContextBudget: () => enqueueRefresh(),
  }
}
