import type { ModelMessage } from 'ai'
import modelMessageText from './model-message-text'

const SNIPPET_CHARS = 1500
const MAX_FALLBACK_CHARS = 4000

const clip = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value
  }
  return `${value.slice(0, Math.max(0, maxChars - 16))}\n[truncated]`
}

export default (messages: ModelMessage[]): string => {
  const firstUser = messages.find((message) => message.role === 'user')
  const last = messages[messages.length - 1]
  const roleCounts = messages.reduce(
    (counts, message) => {
      counts[message.role] = (counts[message.role] ?? 0) + 1
      return counts
    },
    {} as Record<string, number>,
  )
  const roleSummary = Object.entries(roleCounts)
    .map(([role, count]) => `${role}=${count}`)
    .join(', ')

  const lines = [
    'Deterministic compaction fallback. Checkpoint generation failed or the rewritten prompt still exceeded the model window.',
    `Message count: ${messages.length}. Roles: ${roleSummary}.`,
  ]

  if (firstUser) {
    lines.push(`First user: ${clip(modelMessageText(firstUser), SNIPPET_CHARS)}`)
  }

  if (last && last !== firstUser) {
    lines.push(`Latest: ${clip(modelMessageText(last), SNIPPET_CHARS)}`)
  }

  return clip(lines.join('\n'), MAX_FALLBACK_CHARS)
}
