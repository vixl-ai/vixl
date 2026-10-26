import type { ModelMessage } from 'ai'
import { listShellsForChat } from '@/services/harness/shell/registry'

const messagePartToolCallId = (part: unknown): string | null => {
  if (!part || typeof part !== 'object' || !('type' in part) || !('toolCallId' in part)) {
    return null
  }
  if (part.type !== 'tool-call' && part.type !== 'tool-result') {
    return null
  }
  return typeof part.toolCallId === 'string' ? part.toolCallId : null
}

const listParentBackgroundShellToolCallIds = (chatId: string): string[] =>
  listShellsForChat(chatId).flatMap((shell) => {
    if (!shell.background || !shell.wakeParent || shell.subagentId || !shell.toolCallId) {
      return []
    }
    return [shell.toolCallId]
  })

export const turnSpawnedParentBackgroundShells = (
  chatId: string,
  messages: ModelMessage[],
): boolean => {
  const spawnIds = new Set(listParentBackgroundShellToolCallIds(chatId))
  if (spawnIds.size === 0) {
    return false
  }
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue
    }
    for (const part of message.content) {
      const toolCallId = messagePartToolCallId(part)
      if (toolCallId && spawnIds.has(toolCallId)) {
        return true
      }
    }
  }
  return false
}
