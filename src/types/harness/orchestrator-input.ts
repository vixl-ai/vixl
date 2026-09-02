import type { UIMessage } from 'ai'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ContextMention } from '@/types/harness/context-mention'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionCapabilityKey, PermissionLevel } from '@/types/harness/permission'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { SubagentResult } from '@/types/harness/subagent-record'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'

export type OrchestratorInput = {
  projectSlug: string
  chatId: string
  projectRoot: string
  projectName: string
  mode: VixlChatMode
  modelId: string
  providerId: string
  settings: VixlSettings
  messages: UIMessage[]
  timeline?: ChatTimelineItem[]
  userText: string
  mentions: ContextMention[]
  signal: AbortSignal
  onEvent: (event: HarnessEvent) => void
  assistantId?: string
  skipUserPersist?: boolean
  standalone?: boolean
  permissionLevel?: PermissionLevel
  reasoning?: ReasoningLevel
  persistPermission?: (
    capability: PermissionCapabilityKey,
    verdict: 'allow' | 'deny',
    scope: 'workspace' | 'always',
  ) => Promise<void>
  sessionAllows: Set<string>
  sessionDenies: Set<string>
}

export type ResumeOrchestratorInput = Omit<
  OrchestratorInput,
  'userText' | 'skipUserPersist'
> & {
  completedResults: Array<{ toolCallId: string; result: SubagentResult }>
  skipUserPersist: true
}
