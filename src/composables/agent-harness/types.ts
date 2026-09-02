import type { ChatStatus } from 'ai'
import type { Ref, ShallowRef } from 'vue'
import type { ChatAttention } from '@/types/chat/chat-attention'
import type { PendingMcpAuthView } from '@/types/chat/pending-mcp-auth'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { TurnUsageAggregate } from '@/types/billing/turn-usage-aggregate'
import type { AgentHarnessOptions } from '@/types/harness/agent-harness-options'
import type { ContextMention } from '@/types/harness/context-mention'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionLevel } from '@/types/harness/permission'
import type { SubagentEntry } from '@/types/harness/subagent-entry'
import type { ToolRun } from '@/types/harness/tool-run'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import type useChatStore from '@/composables/use-chat-store'
import type useContextUsage from '@/composables/use-context-usage'
import type useChatContextBudgetSync from '@/composables/use-chat-context-budget-sync'
import type useVixlConfig from '@/composables/use-vixl-config'
import type useFleetSidebar from '@/composables/use-fleet-sidebar'
import type useWorkbenchStore from '@/composables/use-workbench-store'
import type useMcpServers from '@/composables/use-mcp-servers'
import type useMessageQueue from '@/composables/use-message-queue'

export type AgentHarnessSession = ReturnType<
  ReturnType<typeof useChatStore>['forChat']
>

export type LastRunConfig = {
  mode: VixlChatMode
  model: string
  reasoning?: ReasoningLevel
  mentions: ContextMention[]
  effectiveSettings: VixlSettings
}

export type AgentHarnessState = {
  options: AgentHarnessOptions
  session: AgentHarnessSession
  config: ReturnType<typeof useVixlConfig>
  contextUsage: ReturnType<typeof useContextUsage>
  contextBudgetSync: ReturnType<typeof useChatContextBudgetSync>
  fleetSidebar: ReturnType<typeof useFleetSidebar>
  workbench: ReturnType<typeof useWorkbenchStore>
  mcpServers: ReturnType<typeof useMcpServers>
  messageQueue: ReturnType<typeof useMessageQueue>
  chatStore: ReturnType<typeof useChatStore>
  status: Ref<ChatStatus>
  error: Ref<string | null>
  pendingApprovals: ShallowRef<PendingApprovalView[]>
  pendingMcpAuth: ShallowRef<PendingMcpAuthView[]>
  toolRuns: ShallowRef<ToolRun[]>
  subagents: ShallowRef<SubagentEntry[]>
  abortController: Ref<AbortController | null>
  liveEvents: Ref<HarnessEvent[]>
  sessionPermissionLevel: Ref<PermissionLevel | null>
  lastRunConfig: Ref<LastRunConfig | null>
  resumingBackgroundBatch: Ref<boolean>
  compacting: Ref<boolean>
  billableUsageRecords: ShallowRef<BillableUsageRecord[]>
  turnUsageByTurnId: ShallowRef<Record<string, TurnUsageAggregate>>
  mcpAuthPollTimer: { current: ReturnType<typeof setInterval> | null }
  sessionAllows: Set<string>
  sessionDenies: Set<string>
}

export type AttentionHelpers = {
  refreshSidebar: () => void
  setChatAttention: (attention: ChatAttention) => void
  maybeClearAttentionWhenGatesEmpty: () => void
  applyTurnEndAttention: (outcome: 'success' | 'error') => void
  isParentBusy: () => boolean
  isWaitingOnBackground: () => boolean
  isFullyIdle: () => boolean
}
