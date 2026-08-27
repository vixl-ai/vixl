import type { ModelMessage } from 'ai'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import compactBudgets from './budgets'

const serializeModelMessageText = (message: ModelMessage): string => {
  if ('content' in message && typeof message.content === 'string') {
    return message.content
  }
  if ('content' in message) {
    return JSON.stringify(message.content)
  }
  return JSON.stringify(message)
}

export default (messages: ModelMessage[]): string => {
  const reversed = [...messages].reverse()
  const kept: string[] = []
  let tokens = 0

  for (const message of reversed) {
    const text = serializeModelMessageText(message)
    if (!text) {
      continue
    }
    const line = `${message.role.toUpperCase()}:\n${text}`
    const estimate = estimateTextTokens(line)
    const remaining = compactBudgets.TRANSCRIPT_TOKEN_BUDGET - tokens
    if (estimate > remaining) {
      if (kept.length > 0) {
        break
      }
      const truncated = line.slice(0, Math.max(0, remaining * 4))
      if (truncated) {
        kept.unshift(truncated)
      }
      break
    }
    tokens += estimate
    kept.unshift(line)
  }

  if (kept.length === 0) {
    return '(empty conversation)'
  }

  return kept.join('\n\n')
}
