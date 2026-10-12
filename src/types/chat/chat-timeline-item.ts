import type { UIMessage } from 'ai'
import type { AgentStop } from '@/types/chat/agent-stop'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { TodoItem } from '@/types/harness/harness-event'
import type { ToolRun } from '@/types/harness/tool-run'

export type SubagentSteer = { message: string; toolBoundary: number }

export type SubagentTimelineItem = {
  type: 'subagent'
  subagentId: string
  toolCallId?: string
  name: string
  blocking: boolean
  status: 'running' | 'done' | 'stopped' | 'error'
  summary?: string
  prompt?: string
  model?: string
  tools: ToolRun[]
  compacting?: boolean
  compactions: Array<{ summary: string; focus: string | null; toolBoundary: number }>
  messages?: unknown[]
  steers?: SubagentSteer[]
  pendingSteers?: string[]
  stop?: AgentStop
}

export type ChatTimelineItem =
  | { type: 'user'; message: UIMessage }
  | { type: 'agent-turn'; turn: AgentTurn }
  | { type: 'todo'; todos: TodoItem[] }
  | SubagentTimelineItem
  | { type: 'compaction'; summary: string; focus: string | null }
