import type { ModelMessage } from 'ai'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const partToolCallId = (part: unknown, type: string): string | undefined => {
  if (!isRecord(part) || part.type !== type) {
    return undefined
  }
  return typeof part.toolCallId === 'string' ? part.toolCallId : undefined
}

const collectIds = (
  messages: ModelMessage[],
  role: 'assistant' | 'tool',
  type: 'tool-call' | 'tool-result',
): Set<string> => {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role !== role || !Array.isArray(message.content)) {
      continue
    }
    for (const part of message.content) {
      const id = partToolCallId(part, type)
      if (id) {
        ids.add(id)
      }
    }
  }
  return ids
}

export default (messages: ModelMessage[]): ModelMessage[] => {
  const callIds = collectIds(messages, 'assistant', 'tool-call')
  const resultIds = collectIds(messages, 'tool', 'tool-result')
  const paired = new Set([...callIds].filter((id) => resultIds.has(id)))

  const next: ModelMessage[] = []
  for (const message of messages) {
    if (message.role === 'tool' && Array.isArray(message.content)) {
      const content = message.content.filter((part) => {
        const id = partToolCallId(part, 'tool-result')
        return id ? paired.has(id) : true
      })
      if (content.length === 0) {
        continue
      }
      next.push({ ...message, content })
      continue
    }

    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const content = message.content.filter((part) => {
        const id = partToolCallId(part, 'tool-call')
        return id ? paired.has(id) : true
      })
      if (content.length === 0) {
        continue
      }
      next.push({ ...message, content })
      continue
    }

    next.push(message)
  }
  return next
}
