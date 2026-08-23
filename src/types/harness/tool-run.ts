import type { ChatArtifact } from '@/types/chat/chat-artifact'
import type { FileDiff } from '@/types/harness/file-diff'

export type TerminalToolPriorPhase = {
  sandboxed?: boolean
  stdout?: string
  stderr?: string
  error?: string
  exitCode?: number | null
  shellId?: string
}

export type ToolRun = {
  toolCallId: string
  name: string
  status: 'running' | 'done' | 'error' | 'rejected'
  args?: unknown
  result?: unknown
  artifact?: ChatArtifact
  diffs?: FileDiff[]
}
