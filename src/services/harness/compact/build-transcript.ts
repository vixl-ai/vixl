import type { UIMessage } from 'ai'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import compactBudgets from './budgets'

const serializeMessageText = (message: UIMessage): string =>
  message.parts
    .map((part) => {
      if (part.type === 'text' || part.type === 'reasoning') {
        return part.text
      }
      return JSON.stringify(part)
    })
    .join('\n')
    .trim()

export default (messages: UIMessage[]): string => {
  const reversed = [...messages].reverse()
  const kept: string[] = []
  let tokens = 0

  for (const message of reversed) {
    const text = serializeMessageText(message)
    if (!text) {
      continue
    }
    const line = `${message.role.toUpperCase()}:\n${text}`
    const estimate = estimateTextTokens(line)
    if (
      tokens + estimate > compactBudgets.TRANSCRIPT_TOKEN_BUDGET &&
      kept.length > 0
    ) {
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
