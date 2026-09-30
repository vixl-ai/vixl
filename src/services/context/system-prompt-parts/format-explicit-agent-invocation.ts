import type { ContextMention } from '@/types/harness/context-mention'

export default (mentions: ContextMention[]): string => {
  const names: string[] = []
  const seen = new Set<string>()
  for (const mention of mentions) {
    if (mention.type !== 'agent') {
      continue
    }
    const name = mention.name.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) {
      continue
    }
    seen.add(key)
    names.push(name)
  }
  if (names.length === 0) {
    return ''
  }
  return [
    `The user explicitly invoked these subagents: ${names.join(', ')}`,
    'Call spawn_subagent once per name, with agentName set to that catalog name exactly and the rest of the user message as prompt; the specialist work belongs to those subagents.',
  ].join('\n')
}
