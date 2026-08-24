import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { PermissionLevel } from '@/types/harness/permission'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'

const PENDING_MESSAGE_KEY = 'vixl:pending-chat-message'
export const PENDING_CHAT_MESSAGE_EVENT = 'vixl:pending-chat-message'

export type PendingChatMessage = {
  text: string
  mode: VixlChatMode
  model: string
  permissionLevel?: PermissionLevel
  subagentModel?: string
  reasoning?: string
  subagentReasoning?: string
  files?: FileUIPart[]
  mentions?: ContextMention[]
}

const omitMedia = (payload: PendingChatMessage): PendingChatMessage => ({
  text: payload.text,
  mode: payload.mode,
  model: payload.model,
  ...(payload.permissionLevel ? { permissionLevel: payload.permissionLevel } : {}),
  ...(payload.subagentModel ? { subagentModel: payload.subagentModel } : {}),
  ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
  ...(payload.subagentReasoning
    ? { subagentReasoning: payload.subagentReasoning }
    : {}),
})

const writePending = (payload: PendingChatMessage): void => {
  sessionStorage.setItem(PENDING_MESSAGE_KEY, JSON.stringify(payload))
}

export const setPendingChatMessage = (payload: PendingChatMessage): void => {
  // Element attachments as data URLs can exceed sessionStorage quota. If that
  // happens, fall back to text-only so the new chat still starts (files and
  // mentions are dropped).
  try {
    writePending(payload)
  } catch {
    writePending(omitMedia(payload))
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PENDING_CHAT_MESSAGE_EVENT))
  }
}

export const consumePendingChatMessage = (): PendingChatMessage | null => {
  const raw = sessionStorage.getItem(PENDING_MESSAGE_KEY)
  if (!raw) {
    return null
  }
  sessionStorage.removeItem(PENDING_MESSAGE_KEY)
  try {
    return JSON.parse(raw) as PendingChatMessage
  } catch {
    return null
  }
}
