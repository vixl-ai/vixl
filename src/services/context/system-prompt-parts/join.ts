import type { SystemPromptParts } from './types'

export default (parts: SystemPromptParts): string =>
  [
    parts.base,
    parts.tools,
    parts.mcp,
    parts.agentsMd,
    parts.rules,
    parts.subagents,
    parts.mentions,
    parts.skills,
  ]
    .filter(Boolean)
    .join('\n\n')
