import type { ModelMessage } from 'ai'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import compactBudgets from './budgets'
import { estimatePromptTokens } from './prompt-high-water'
import repairToolPairing from './repair-tool-pairing'
import truncateModelMessage from './truncate-model-message'

const MIN_MESSAGE_TOKENS = 32

const isCheckpoint = (message: ModelMessage): boolean =>
  typeof message.content === 'string' &&
  message.content.startsWith(compactBudgets.CHECKPOINT_PREFIX)

const messageTokens = (message: ModelMessage): number =>
  estimateTextTokens(JSON.stringify(message))

const dropOldestTail = (messages: ModelMessage[]): ModelMessage[] | null => {
  const checkpointIndex = messages.findIndex(isCheckpoint)
  const dropIndex = checkpointIndex >= 0 ? checkpointIndex + 1 : 1
  if (dropIndex <= 0 || dropIndex >= messages.length) {
    return null
  }
  return messages.filter((_, index) => index !== dropIndex)
}

const shrinkLargest = (messages: ModelMessage[]): ModelMessage[] | null => {
  let largestIndex = -1
  let largestTokens = MIN_MESSAGE_TOKENS
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message) {
      continue
    }
    const tokens = messageTokens(message)
    if (tokens > largestTokens) {
      largestIndex = index
      largestTokens = tokens
    }
  }
  if (largestIndex < 0) {
    return null
  }
  const target = Math.max(MIN_MESSAGE_TOKENS, Math.floor(largestTokens / 2))
  const current = messages[largestIndex]
  if (!current) {
    return null
  }
  const truncated = truncateModelMessage(current, target)
  if (messageTokens(truncated) >= largestTokens) {
    return null
  }
  return messages.map((message, index) =>
    index === largestIndex ? truncated : message,
  )
}

export default (
  messages: ModelMessage[],
  system: string,
  highWater: number,
): ModelMessage[] => {
  let next = repairToolPairing(messages)

  while (estimatePromptTokens(system, next) > highWater) {
    const shrunk = shrinkLargest(next)
    if (!shrunk) {
      break
    }
    next = repairToolPairing(shrunk)
  }

  while (estimatePromptTokens(system, next) > highWater) {
    const dropped = dropOldestTail(next)
    if (!dropped) {
      break
    }
    next = repairToolPairing(dropped)
  }

  while (estimatePromptTokens(system, next) > highWater) {
    const shrunk = shrinkLargest(next)
    if (!shrunk) {
      break
    }
    next = repairToolPairing(shrunk)
  }

  return repairToolPairing(next)
}
