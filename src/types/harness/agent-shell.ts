export type AgentShellStatus = 'running' | 'completed' | 'failed'

export type AgentShellRecord = {
  shellId: string
  chatId: string
  projectRoot: string
  command: string
  status: AgentShellStatus
  stdout: string
  stderr: string
  exitCode: number | null
  exitSignal: number | null
  startedAt: string
  background: boolean
  wakeParent: boolean
  toolCallId?: string
  subagentId?: string
  description?: string
}

export type ShellWakeResult = {
  toolCallId: string
  shellId: string
  command: string
  description?: string
  exitCode: number
  signal?: number
  stdout: string
  stderr: string
}
