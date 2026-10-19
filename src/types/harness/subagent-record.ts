import type { ModelMessage } from 'ai'

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'aborted'

export type SubagentResult = {
  subagentId: string
  name: string
  summary: string
}

export type SubagentWorkspace = {
  projectRoot: string
  projectSlug: string
}

export type SubagentRecord = {
  subagentId: string
  chatId: string
  toolCallId: string
  agentName: string
  status: SubagentStatus
  result?: SubagentResult
  startedAt: string
  prompt?: string
  model?: string
  capabilities?: 'read-only' | 'write'
  workspace?: SubagentWorkspace
  messages?: ModelMessage[]
}
