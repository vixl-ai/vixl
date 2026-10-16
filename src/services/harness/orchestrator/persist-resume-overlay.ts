import type { ModelMessage } from 'ai'
import { persistLine } from './persistence'
import { nowIso } from './helpers'
import itemsByChat from './resume-overlay-cache'

const collectToolCallIds = (messages: ModelMessage[]): string[] => {
  const ids = new Set<string>()
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue
    }
    for (const part of message.content) {
      if (
        (part.type === 'tool-call' || part.type === 'tool-result') &&
        typeof part.toolCallId === 'string'
      ) {
        ids.add(part.toolCallId)
      }
    }
  }
  return [...ids].sort()
}

const spawnLineId = (chatId: string, messages: ModelMessage[]): string => {
  const toolCallIds = collectToolCallIds(messages)
  const fingerprint =
    toolCallIds.length > 0 ? toolCallIds.join(',') : JSON.stringify(messages)
  return `background-spawn-turn:${chatId}:${fingerprint}`
}

const wakeLineId = (chatId: string, toolCallIds: string[]): string =>
  `background-wake:${chatId}:${[...toolCallIds].sort().join(',')}`

const hasLine = (chatId: string, lineId: string): boolean =>
  (itemsByChat.get(chatId) ?? []).some((item) => item.id === lineId)

const remember = (
  chatId: string,
  item:
    | { kind: 'spawn'; id: string; messages: ModelMessage[] }
    | {
        kind: 'wake'
        id: string
        content: string
        toolCallIds: string[]
        resultKeys: string[]
      },
): void => {
  const existing = itemsByChat.get(chatId) ?? []
  existing.push(item)
  itemsByChat.set(chatId, existing)
}

export default async (input: {
  projectSlug: string
  chatId: string
  spawnMessages?: ModelMessage[]
  wake?: { content: string; toolCallIds: string[]; resultKeys: string[] }
}): Promise<void> => {
  if (input.spawnMessages && input.spawnMessages.length > 0) {
    const id = spawnLineId(input.chatId, input.spawnMessages)
    if (!hasLine(input.chatId, id)) {
      remember(input.chatId, {
        kind: 'spawn',
        id,
        messages: input.spawnMessages,
      })
      await persistLine(input.projectSlug, input.chatId, {
        id,
        role: 'assistant',
        parts: [],
        createdAt: nowIso(),
        harnessEvent: {
          type: 'background-spawn-turn',
          messages: input.spawnMessages,
        },
      })
    }
  }

  if (input.wake && input.wake.toolCallIds.length > 0) {
    const id = wakeLineId(input.chatId, input.wake.resultKeys)
    if (!hasLine(input.chatId, id)) {
      remember(input.chatId, {
        kind: 'wake',
        id,
        content: input.wake.content,
        toolCallIds: input.wake.toolCallIds,
        resultKeys: input.wake.resultKeys,
      })
      await persistLine(input.projectSlug, input.chatId, {
        id,
        role: 'user',
        parts: [{ type: 'text', text: input.wake.content }],
        createdAt: nowIso(),
      })
    }
  }
}
