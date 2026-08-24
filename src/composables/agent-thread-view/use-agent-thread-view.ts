import { computed, ref, shallowRef, unref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ChatStatus } from 'ai'
import type { PermissionLevel } from '@/types/harness/permission'
import type { QueuedChatMessage } from '@/types/chat/queued-chat-message'
import useAgentHarness from '@/composables/use-agent-harness'
import useChatStore from '@/composables/use-chat-store'
import useChatContextActions from '@/composables/use-chat-context-actions'
import useChatContextBudgetSync from '@/composables/use-chat-context-budget-sync'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useFleetSidebar from '@/composables/use-fleet-sidebar'
import useVixlConfig from '@/composables/use-vixl-config'
import useMcpServers from '@/composables/use-mcp-servers'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { HOME_CHAT_SLUG, isHomeChatSlug } from '@/constants/home-chat'
import { listShellsForChat } from '@/services/harness/shell/registry'
import buildSubagentTimeline from '@/utils/build-subagent-timeline'
import { createHandlers } from './handlers'
import { bindAgentThreadLifecycle } from './lifecycle'
import { createSessionOps } from './session'
import type { AgentThreadViewState, PendingFilePolicyAction } from './types'

export default () => {
  const route = useRoute()
  const router = useRouter()
  const fleet = useFleetRegistry()
  const fleetSidebar = useFleetSidebar()
  const chatStore = useChatStore()
  const config = useVixlConfig()
  const {
    personalMcp: mcpPersonalConfig,
    projectMcp: mcpProjectConfig,
  } = useMcpServers()
  const contextActions = useChatContextActions()
  const workbench = useWorkbenchStore()
  const contextBudgetSync = useChatContextBudgetSync()

  const harness = shallowRef<ReturnType<typeof useAgentHarness> | null>(null)
  const threadReady = ref(false)
  const loadedThreadKey = ref<string | null>(null)
  const loadGeneration = ref(0)
  const homeRoot = ref<string | null>(null)
  const paintedSession = shallowRef<ReturnType<typeof chatStore.forChat> | null>(null)
  const sessionPermissionLevel = ref<PermissionLevel>(
    config.effectiveSettings.value['agent.permissionLevel'] ?? 'allowlist',
  )
  const permissionLevelTouched = ref(false)

  const filePolicyOpen = ref(false)
  const filePolicyChanges = ref<AgentThreadViewState['filePolicyChanges']['value']>([])
  const filePolicyTitle = ref('Submit edited message?')
  const filePolicyEmphasizeRevert = ref(false)
  const pendingFilePolicyAction = ref<PendingFilePolicyAction | null>(null)

  const isStandalone = computed(
    () =>
      route.name === 'home-chat' ||
      route.name === 'home-chat-subagent' ||
      isHomeChatSlug(String(route.params.slug ?? '')),
  )
  const projectSlug = computed(() =>
    isStandalone.value ? HOME_CHAT_SLUG : String(route.params.slug ?? ''),
  )
  const chatId = computed(() => String(route.params.chatId ?? ''))
  const subagentId = computed(() => String(route.params.subagentId ?? ''))
  const isSubagentView = computed(() => Boolean(subagentId.value))
  const threadKey = computed(() =>
    chatId.value ? `${projectSlug.value}:${chatId.value}` : '',
  )
  const project = computed(
    () => fleet.projects.value.find((item) => item.slug === projectSlug.value) ?? null,
  )
  const harnessStatus = computed((): ChatStatus => {
    if (isSubagentView.value) {
      const subagent = paintedSession.value?.getSubagent(subagentId.value) ?? null
      return subagent?.status === 'running' ? 'streaming' : 'ready'
    }
    const status = unref(harness.value?.status) ?? 'ready'
    if (status === 'streaming' || status === 'submitted') {
      return status
    }
    const hasRunningSubagent = (paintedSession.value?.timeline.value ?? []).some(
      (item) => item.type === 'subagent' && item.status === 'running',
    )
    return hasRunningSubagent ? 'streaming' : status
  })
  const harnessPendingApprovals = computed(
    () => unref(harness.value?.pendingApprovals) ?? [],
  )
  const harnessPendingMcpAuth = computed(
    () => unref(harness.value?.pendingMcpAuth) ?? [],
  )
  const queuedMessages = computed<QueuedChatMessage[]>(
    () => unref(harness.value?.queuedMessages) ?? [],
  )
  const isWaitingOnBackground = computed(() => {
    // The subagent registry is module-level state, not reactive. Depend on the
    // harness subagents ref so this recomputes when subagent status changes.
    const subagents = unref(harness.value?.subagents) ?? []
    return subagents.length >= 0 && (harness.value?.isWaitingOnBackground() ?? false)
  })
  const chatPromptInputRef = ref<{
    hydrateQueuedMessage: (item: QueuedChatMessage) => Promise<void>
  } | null>(null)
  const pendingQuestion = computed(
    () => paintedSession.value?.pendingQuestion.value ?? null,
  )
  const timeline = computed(() => {
    if (!isSubagentView.value) {
      return paintedSession.value?.timeline.value ?? []
    }
    const subagent = paintedSession.value?.getSubagent(subagentId.value) ?? null
    if (!subagent) {
      return []
    }
    return buildSubagentTimeline(subagent)
  })
  const todos = computed(() =>
    isSubagentView.value ? [] : (paintedSession.value?.todos.value ?? []),
  )

  const runningShells = computed(() => {
    // Touch liveEvents so terminal lifecycle events re-run this computed.
    const liveEventCount = unref(harness.value?.liveEvents)?.length ?? 0
    const shells = listShellsForChat(chatId.value).filter((shell) => shell.status === 'running')
    return liveEventCount < 0 ? [] : shells
  })

  const activePermissionLevel = computed((): PermissionLevel => {
    return sessionPermissionLevel.value
  })

  const state: AgentThreadViewState = {
    route,
    router,
    fleet,
    fleetSidebar,
    chatStore,
    config,
    mcpPersonalConfig,
    mcpProjectConfig,
    contextActions,
    workbench,
    contextBudgetSync,
    harness,
    threadReady,
    loadedThreadKey,
    loadGeneration,
    homeRoot,
    paintedSession,
    sessionPermissionLevel,
    permissionLevelTouched,
    filePolicyOpen,
    filePolicyChanges,
    filePolicyTitle,
    filePolicyEmphasizeRevert,
    pendingFilePolicyAction,
    isStandalone,
    projectSlug,
    chatId,
    subagentId,
    isSubagentView,
    threadKey,
    project,
    harnessStatus,
    chatPromptInputRef,
  }

  const session = createSessionOps(state)
  const handlers = createHandlers(state)
  bindAgentThreadLifecycle(state, session, handlers)

  return {
    workbench,
    contextActions,
    mcpPersonalConfig,
    mcpProjectConfig,
    threadReady,
    projectSlug,
    chatId,
    isSubagentView,
    threadKey,
    harnessStatus,
    harnessPendingApprovals,
    harnessPendingMcpAuth,
    queuedMessages,
    isWaitingOnBackground,
    chatPromptInputRef,
    pendingQuestion,
    timeline,
    todos,
    runningShells,
    activePermissionLevel,
    filePolicyOpen,
    filePolicyChanges,
    filePolicyTitle,
    filePolicyEmphasizeRevert,
    ...handlers,
  }
}
