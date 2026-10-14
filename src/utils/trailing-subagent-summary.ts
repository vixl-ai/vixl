import type { AgentStep } from '@/types/chat/agent-step'

const stepContentPrefixes = (steps: AgentStep[]): string[] => {
  const texts = steps
    .map((step) => step.text.trim())
    .filter((text) => text.length > 0)
  if (texts.length === 0) {
    return []
  }
  const prefixes = new Set<string>([
    texts[texts.length - 1]!,
    texts.join('\n\n'),
    texts.join('\n'),
    texts.join(''),
  ])
  return [...prefixes].sort((left, right) => right.length - left.length)
}

const remainderAfterPrefix = (summary: string, prefix: string): string | null => {
  if (summary === prefix) {
    return ''
  }
  if (!summary.startsWith(prefix)) {
    return null
  }
  const rest = summary.slice(prefix.length)
  if (rest.length === 0 || /^\s/.test(rest)) {
    return rest.trim()
  }
  return null
}

const trailingSubagentSummary = (
  summary: string | undefined,
  steps: AgentStep[],
): string => {
  const trimmed = summary?.trim() ?? ''
  if (!trimmed) {
    return ''
  }
  for (const prefix of stepContentPrefixes(steps)) {
    const remainder = remainderAfterPrefix(trimmed, prefix)
    if (remainder !== null) {
      return remainder
    }
  }
  return trimmed
}

export default trailingSubagentSummary
