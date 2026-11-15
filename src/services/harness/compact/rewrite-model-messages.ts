import type { ModelMessage } from 'ai'
import compactBudgets from './budgets'
import estimateModelMessageTokens, {
  messageHasImagePart,
} from './estimate-model-message-tokens'
import truncateModelMessage, {
  omitCompactFileParts,
} from './truncate-model-message'

const estimateMessageTokens = (message: ModelMessage): number =>
  estimateModelMessageTokens(message)

const hasAssistantText = (message: ModelMessage): boolean => {
  if (message.role !== 'assistant') {
    return false
  }
  if (typeof message.content === 'string') {
    return message.content.trim().length > 0
  }
  return message.content.some(
    (part) => part.type === 'text' && part.text.trim().length > 0,
  )
}

const isCheckpointUser = (message: ModelMessage): boolean =>
  message.role === 'user' &&
  typeof message.content === 'string' &&
  message.content.startsWith(compactBudgets.CHECKPOINT_PREFIX)

const lastIndexWhere = (
  messages: ModelMessage[],
  predicate: (message: ModelMessage) => boolean,
): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message && predicate(message)) {
      return index
    }
  }
  return -1
}

const frameFirstUser = (message: ModelMessage): ModelMessage => {
  const prefix = compactBudgets.FIRST_USER_PREFIX
  if (message.role !== 'user') {
    return message
  }

  if (typeof message.content === 'string') {
    if (message.content.startsWith(prefix)) {
      return message
    }
    return { ...message, content: `${prefix}\n${message.content}` }
  }

  const firstText = message.content.find((part) => part.type === 'text')
  if (
    firstText &&
    firstText.type === 'text' &&
    firstText.text.startsWith(prefix)
  ) {
    return message
  }

  let prefixed = false
  const content = message.content.map((part) => {
    if (prefixed || part.type !== 'text') {
      return part
    }
    prefixed = true
    return { ...part, text: `${prefix}\n${part.text}` }
  })

  if (!prefixed) {
    return {
      ...message,
      content: [{ type: 'text' as const, text: prefix }, ...message.content],
    }
  }

  return { ...message, content }
}

export default (messages: ModelMessage[], summary: string): ModelMessage[] => {
  // Keep the most recent image alive through compaction so the agent can act
  // on the latest screenshot; older image payloads are placeholders.
  const lastImageIndex = lastIndexWhere(messages, messageHasImagePart)
  const normalized = messages.map((message, index) =>
    omitCompactFileParts(message, { keepImages: index === lastImageIndex }),
  )
  const firstUserIndex = normalized.findIndex(
    (message) => message.role === 'user' && !isCheckpointUser(message),
  )
  const firstUser =
    firstUserIndex >= 0 ? normalized[firstUserIndex] : undefined
  const remaining =
    firstUserIndex >= 0
      ? normalized.filter((_, index) => index !== firstUserIndex)
      : normalized

  const guaranteedIndexes = new Set(
    [
      lastIndexWhere(remaining, (message) => message.role === 'user'),
      lastIndexWhere(remaining, hasAssistantText),
    ].filter((index) => index >= 0),
  )

  const kept: ModelMessage[] = []
  let tokens = 0
  const budget = compactBudgets.ACTIVE_WINDOW_TOKEN_BUDGET

  for (let index = remaining.length - 1; index >= 0; index -= 1) {
    const message = remaining[index]
    if (!message) {
      continue
    }

    const estimate = estimateMessageTokens(message)
    if (tokens + estimate <= budget) {
      tokens += estimate
      kept.unshift(message)
      continue
    }

    if (!guaranteedIndexes.has(index)) {
      continue
    }

    const truncated = truncateModelMessage(
      message,
      Math.max(0, budget - tokens),
    )
    tokens += estimateMessageTokens(truncated)
    kept.unshift(truncated)
  }

  if (kept.length === 0 && remaining.length > 0) {
    const last = remaining[remaining.length - 1]
    if (last) {
      const estimate = estimateMessageTokens(last)
      kept.push(estimate > budget ? truncateModelMessage(last, budget) : last)
    }
  }

  const checkpoint: ModelMessage = {
    role: 'user',
    content: `${compactBudgets.CHECKPOINT_PREFIX}\n${summary}`,
  }

  if (firstUser) {
    const framed = truncateModelMessage(
      frameFirstUser(firstUser),
      compactBudgets.FIRST_USER_TOKEN_BUDGET,
    )
    return [framed, checkpoint, ...kept]
  }

  return [checkpoint, ...kept]
}
