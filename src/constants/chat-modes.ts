import {
  BarChart3Icon,
  BotIcon,
  CircleHelpIcon,
  ListTodoIcon,
  NetworkIcon,
} from '@lucide/vue'
import type { Component } from 'vue'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'

export type ChatModeMeta = {
  value: VixlChatMode
  label: string
  icon: Component
}

export const CHAT_MODES: ChatModeMeta[] = [
  { value: 'ask', label: 'Ask', icon: CircleHelpIcon },
  { value: 'plan', label: 'Plan', icon: ListTodoIcon },
  { value: 'studio', label: 'Studio', icon: BarChart3Icon },
  { value: 'agent', label: 'Agent', icon: BotIcon },
  { value: 'orchestrator', label: 'Orchestrator', icon: NetworkIcon },
]

export const getChatModeMeta = (mode: VixlChatMode): ChatModeMeta =>
  CHAT_MODES.find((entry) => entry.value === mode) ?? CHAT_MODES[3]!
