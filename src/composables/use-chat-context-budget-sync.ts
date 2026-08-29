import { ref, watch } from 'vue'
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

let watchStarted = false
let stopBudgetWatch: (() => void) | null = null

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopBudgetWatch?.()
    stopBudgetWatch = null
    watchStarted = false
  })
}

const timelineBudgetKey = (timeline: ChatTimelineItem[]): string =>
  timeline
    .map((item) => {
      if (item.type === 'user') {
        const partChars = item.message.parts.reduce((sum, part) => {
          if (
            part &&
            typeof part === 'object' &&
            'text' in part &&
            typeof (part as { text: unknown }).text === 'string'
          ) {
            return sum + (part as { text: string }).text.length
          }
          return sum + 8
        }, 0)
        return `u:${item.message.id}:${item.message.parts.length}:${partChars}`
      }
      if (item.type === 'agent-turn') {
        const turn = item.turn
        const steps = turn.steps
          .map((step) => {
            const tools = step.tools
              .map((tool) => {
                const argChars =
                  tool.args === undefined ? 0 : JSON.stringify(tool.args).length
                const resultChars =
                  tool.result === undefined ? 0 : JSON.stringify(tool.result).length
                return `${tool.toolCallId}:${tool.status}:${argChars}:${resultChars}`
              })
              .join(',')
            return `${step.id}:${step.text.length}:${step.reasoning.length}:${tools}`
          })
          .join('|')
        return `a:${turn.id}:${turn.text.length}:${steps}`
      }
      if (item.type === 'compaction') {
        return `c:${item.summary.length}:${item.focus ?? ''}`
      }
      if (item.type === 'subagent') {
        return `s:${item.subagentId}:${item.status}:${item.summary?.length ?? 0}`
      }
      if (item.type === 'todo') {
        return `t:${item.todos.length}`
      }
      return 'x'
    })
    .join('\n')

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
    if (chatStore.loading.value) {
      return
    }

    const meta = chatStore.meta.value
    const modelId =
      draftModelRef.value ||
      (meta?.model ? normalizeStoredModelRef(meta.model) ?? meta.model : '') ||
      ''
    if (!modelId) {
      return
    }

    const mode = draftMode.value || meta?.mode || 'agent'
    const project = fleet.activeProject.value
    const standalone = meta?.projectSlug === HOME_CHAT_SLUG
    const projectRoot = standalone
      ? meta?.projectRoot
      : project?.rootPath ?? meta?.projectRoot
    if (!projectRoot) {
      return
    }

    const projectName = standalone
      ? 'Home'
      : project?.name ?? meta?.projectSlug ?? 'Home'

    const frozenSnapshot = meta ? getFrozenPrefix(meta) : null
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
      activeContext: meta?.activeContext ?? null,
      chatId: meta?.id,
    })
  }

  if (!watchStarted) {
    watchStarted = true
    stopBudgetWatch = watch(
      [
        draftModelRef,
        draftMode,
        draftMentions,
        () => chatStore.loading.value,
        () => timelineBudgetKey(chatStore.timeline.value),
        () => chatStore.messages.value.length,
        () => fleet.activeProject.value?.id,
        () => chatStore.meta.value?.model,
        () => chatStore.meta.value?.mode,
        () => chatStore.meta.value?.prefixSnapshot?.hash,
        () => chatStore.meta.value?.id,
        () => chatStore.meta.value?.activeContext?.includeFromCreatedAt,
        () => chatStore.meta.value?.activeContext?.summary,
        () => mcpStatusKey(mcp.serverStates.value),
        () => config.effectiveSettings.value['models.catalogOptions'],
        () => config.effectiveSettings.value['models.catalogMeta'],
      ],
      () => {
        const timer = window.setTimeout(() => {
          refreshContextBudget().catch((error) => {
            toast.error('Failed to refresh context usage', {
              description: error instanceof Error ? error.message : 'Unknown error',
            })
          })
        }, 0)
        return () => window.clearTimeout(timer)
      },
      { immediate: true },
    )
  }

  return {
    draftModelRef,
    draftMode,
    draftMentions,
    setDraftSelection,
    setDraftMentions,
    refreshContextBudget,
  }
}
