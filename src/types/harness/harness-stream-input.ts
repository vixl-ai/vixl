import type { ModelMessage, UIMessage } from 'ai'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ContextMention } from '@/types/harness/context-mention'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionCapabilityKey, PermissionLevel } from '@/types/harness/permission'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'

export type HarnessStreamInput = {
  projectSlug: string
  chatId: string
  projectRoot: string
  projectName: string
  mode: VixlChatMode
  modelId: string
  providerId: string
  settings: VixlSettings
  mentions: ContextMention[]
  messages: UIMessage[]
  timeline?: ChatTimelineItem[]
  modelMessages: ModelMessage[]
  userMessageId: string
  signal: AbortSignal
  onEvent: (event: HarnessEvent) => void
  assistantId: string
  captureTurnMessages: boolean
  standalone?: boolean
  permissionLevel?: PermissionLevel
  reasoning?: ReasoningLevel
  activeContext?: {
    summary?: string
    includeFromCreatedAt?: string
  } | null
  persistPermission?: (
    capability: PermissionCapabilityKey,
    verdict: 'allow' | 'deny',
    scope: 'workspace' | 'always',
  ) => Promise<void>
  sessionAllows: Set<string>
  sessionDenies: Set<string>
}
