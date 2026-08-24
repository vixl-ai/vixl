import { call } from './helpers'
import type { ChatMetaRecord } from './types'

export const createChat = (args: {
  projectSlug: string
  projectRoot: string
  mode: string
  model: string
  title?: string
}): Promise<ChatMetaRecord> => call('create_chat', args)

export const listChats = (projectSlug: string): Promise<ChatMetaRecord[]> =>
  call('list_chats', { projectSlug })

export const readChatMeta = (
  projectSlug: string,
  chatId: string,
): Promise<ChatMetaRecord> => call('read_chat_meta', { projectSlug, chatId })

export const readChatMessages = (
  projectSlug: string,
  chatId: string,
): Promise<Record<string, unknown>[]> =>
  call('read_chat_messages', { projectSlug, chatId })

export const appendChatLine = (
  projectSlug: string,
  chatId: string,
  line: Record<string, unknown>,
): Promise<void> => call('append_chat_line', { projectSlug, chatId, line })

export const truncateChatLog = (args: {
  projectSlug: string
  chatId: string
  beforeMessageId?: string
  keepThroughLastUser?: boolean
  keepThroughMessageId?: string
}): Promise<void> => call('truncate_chat_log', args)

export const updateChatMeta = (
  projectSlug: string,
  chatId: string,
  patch: Record<string, unknown>,
): Promise<ChatMetaRecord> => call('update_chat_meta', { projectSlug, chatId, patch })

export const deleteChat = (projectSlug: string, chatId: string): Promise<void> =>
  call('delete_chat', { projectSlug, chatId })

export const forkChat = (projectSlug: string, chatId: string): Promise<ChatMetaRecord> =>
  call('fork_chat', { projectSlug, chatId })

export const fileCheckpointCapture = (args: {
  projectSlug: string
  chatId: string
  userMessageId: string
  projectRoot: string
  path: string
  toolCallId?: string
}): Promise<{
  path: string
  pathHash: string
  existed: boolean
  capturedAt: string
  toolCallId?: string
}> => call('file_checkpoint_capture', args)

export const fileCheckpointRestore = (args: {
  projectSlug: string
  chatId: string
  projectRoot: string
  targets: Array<{ path: string; userMessageId: string }>
}): Promise<{
  restored: string[]
  deleted: string[]
  skipped: string[]
  errors: Array<{ path: string; error: string }>
}> => call('file_checkpoint_restore', args)

export const pinChat = (
  projectSlug: string,
  chatId: string,
  pinned: boolean,
): Promise<ChatMetaRecord> => call('pin_chat', { projectSlug, chatId, pinned })

export const listPinnedChats = (): Promise<ChatMetaRecord[]> => call('list_pinned_chats')
