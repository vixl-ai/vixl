import type { ModelMessage } from 'ai'
import {
  isBackgroundSubagent,
  listSubagentsForChat,
} from '@/services/harness/subagent/registry'

const messagePartToolCallId = (part: unknown): string | null => {
  if (!part || typeof part !== 'object' || !('type' in part) || !('toolCallId' in part)) {
    return null
  }
  if (part.type !== 'tool-call' && part.type !== 'tool-result') {
    return null
  }
  return typeof part.toolCallId === 'string' ? part.toolCallId : null
}

export const listBackgroundToolCallIdsForChat = (chatId: string): string[] =>
  listSubagentsForChat(chatId)
    .filter((record) => isBackgroundSubagent(record.subagentId))
    .map((record) => record.toolCallId)

export const turnSpawnedBackgroundSubagents = (
  chatId: string,
  messages: ModelMessage[],
): boolean => {
  const spawnIds = new Set(listBackgroundToolCallIdsForChat(chatId))
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
