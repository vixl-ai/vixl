import type { ModelMessage } from 'ai'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import compactBudgets from './budgets'

const estimateMessageTokens = (message: ModelMessage): number =>
  estimateTextTokens(JSON.stringify(message))

export default (messages: ModelMessage[], summary: string): ModelMessage[] => {
  const firstUserIndex = messages.findIndex((message) => message.role === 'user')
  const firstUser =
    firstUserIndex >= 0 ? messages[firstUserIndex] : undefined
  const remaining =
    firstUserIndex >= 0
      ? messages.filter((_, index) => index !== firstUserIndex)
      : messages

  const reversed = [...remaining].reverse()
  const kept: ModelMessage[] = []
  let tokens = 0

  for (const message of reversed) {
    const estimate = estimateMessageTokens(message)
    if (tokens + estimate > compactBudgets.ACTIVE_WINDOW_TOKEN_BUDGET) {
      break
    }
    tokens += estimate
    kept.unshift(message)
  }

  if (kept.length === 0 && remaining.length > 0) {
    const last = remaining[remaining.length - 1]
    if (last) {
      kept.push(last)
    }
  }

  const checkpoint: ModelMessage = {
    role: 'user',
    content: `${compactBudgets.CHECKPOINT_PREFIX}\n${summary}`,
  }

  if (firstUser) {
    return [firstUser, checkpoint, ...kept]
  }

  return [checkpoint, ...kept]
}
