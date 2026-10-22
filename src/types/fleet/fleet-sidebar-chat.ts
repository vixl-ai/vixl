import type { ChatAttention } from '@/types/chat/chat-attention'
import type { FleetChatStatus } from './fleet-chat-status'

export interface FleetSidebarChat {
  id: string
  title: string
  status?: FleetChatStatus
  attention?: ChatAttention
  updatedAt?: string
  createdAt?: string
  lastUserMessageAt?: string
  pinned?: boolean
}
