import type { ComputedRef, Ref, ShallowRef } from 'vue'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import type { ChatStatus } from 'ai'
import type { PermissionLevel } from '@/types/harness/permission'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { AggregatedTurnFileChange } from '@/types/harness/file-checkpoint'
import type { QueuedChatMessage } from '@/types/chat/queued-chat-message'
import type useAgentHarness from '@/composables/use-agent-harness'
import type useChatStore from '@/composables/use-chat-store'
import type useFleetRegistry from '@/composables/use-fleet-registry'
import type useFleetSidebar from '@/composables/use-fleet-sidebar'
import type useVixlConfig from '@/composables/use-vixl-config'
import type useChatContextActions from '@/composables/use-chat-context-actions'
import type useWorkbenchStore from '@/composables/use-workbench-store'
import type useChatContextBudgetSync from '@/composables/use-chat-context-budget-sync'
import type useMcpServers from '@/composables/use-mcp-servers'

export type PendingFilePolicyAction =
  | {
      kind: 'edit'
      text: string
      mode: VixlChatMode
      model: string
      reasoning?: ReasoningLevel
    }
  | {
      kind: 'retry'
      mode: VixlChatMode
      model: string
    }

type FleetProject = NonNullable<
  ReturnType<typeof useFleetRegistry>['projects']['value'][number]
>

export type AgentThreadViewState = {
  route: RouteLocationNormalizedLoaded
  router: Router
  fleet: ReturnType<typeof useFleetRegistry>
  fleetSidebar: ReturnType<typeof useFleetSidebar>
  chatStore: ReturnType<typeof useChatStore>
  config: ReturnType<typeof useVixlConfig>
  mcpPersonalConfig: ReturnType<typeof useMcpServers>['personalMcp']
  mcpProjectConfig: ReturnType<typeof useMcpServers>['projectMcp']
  contextActions: ReturnType<typeof useChatContextActions>
  workbench: ReturnType<typeof useWorkbenchStore>
  contextBudgetSync: ReturnType<typeof useChatContextBudgetSync>
  harness: ShallowRef<ReturnType<typeof useAgentHarness> | null>
  threadReady: Ref<boolean>
  loadedThreadKey: Ref<string | null>
  loadGeneration: Ref<number>
  homeRoot: Ref<string | null>
  paintedSession: ShallowRef<ReturnType<ReturnType<typeof useChatStore>['forChat']> | null>
  sessionPermissionLevel: Ref<PermissionLevel>
  permissionLevelTouched: Ref<boolean>
  filePolicyOpen: Ref<boolean>
  filePolicyChanges: Ref<AggregatedTurnFileChange[]>
  filePolicyTitle: Ref<string>
  filePolicyEmphasizeRevert: Ref<boolean>
  pendingFilePolicyAction: Ref<PendingFilePolicyAction | null>
  isStandalone: ComputedRef<boolean>
  projectSlug: ComputedRef<string>
  chatId: ComputedRef<string>
  subagentId: ComputedRef<string>
  isSubagentView: ComputedRef<boolean>
  threadKey: ComputedRef<string>
  project: ComputedRef<FleetProject | null>
  harnessStatus: ComputedRef<ChatStatus>
  chatPromptInputRef: Ref<{
    hydrateQueuedMessage: (item: QueuedChatMessage) => Promise<void>
  } | null>
}
