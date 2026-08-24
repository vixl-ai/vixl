import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { ReasoningLevel } from '@/types/models/reasoning-level'

export interface QueuedChatMessage {
  id: string
  text: string
  files: FileUIPart[]
  mode: VixlChatMode
  model: string
  reasoning?: ReasoningLevel
  mentions?: ContextMention[]
}
