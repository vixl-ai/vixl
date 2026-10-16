import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { ContextMention } from '@/types/harness/context-mention'
import type { PrefixSnapshot } from '@/types/harness/prefix-snapshot'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

export type SystemPromptInput = {
  mode: VixlChatMode
  projectName: string
  projectRoot: string
  mentions: ContextMention[]
  agentCatalog: Array<{ name: string; description: string }>
  standalone?: boolean
  frozenSnapshot?: PrefixSnapshot
  members?: HarnessWorkspaceMember[]
}

export type SystemPromptParts = {
  base: string
  tools: string
  mcp: string
  agentsMd: string
  rules: string
  subagents: string
  mentions: string
  skills: string
}
