import type { MentionHighlight } from '@/types/chat/mention-highlight'

export type UserMessageMetadata = {
  createdAt?: string
  model?: string
  mentionHighlights?: MentionHighlight[]
  harnessWake?: boolean
}
