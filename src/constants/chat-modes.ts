import type { AppIconName } from '@/icons'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'

export type ChatModeMeta = {
  value: VixlChatMode
  label: string
  icon: AppIconName
}

export const CHAT_MODES: ChatModeMeta[] = [
  { value: 'agent', label: 'Agent', icon: 'bot' },
  { value: 'ask', label: 'Ask', icon: 'circle-help' },
  { value: 'orchestrator', label: 'Orchestrator', icon: 'network' },
  { value: 'plan', label: 'Plan', icon: 'list-todo' },
]

const DEFAULT_CHAT_MODE = CHAT_MODES.find((entry) => entry.value === 'agent')!

export const getChatModeMeta = (mode: VixlChatMode): ChatModeMeta =>
  CHAT_MODES.find((entry) => entry.value === mode) ?? DEFAULT_CHAT_MODE
