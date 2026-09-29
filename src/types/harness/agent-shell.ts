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
  subagentId?: string
}
