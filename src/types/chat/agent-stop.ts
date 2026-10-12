export type AgentStopReason =
  | 'completed'
  | 'output-limit'
  | 'content-filter'
  | 'user-stop'
  | 'timeout'
  | 'error'
  | 'failed'
  | 'aborted'
  | 'compaction'
  | 'incomplete'

export type AgentStop = {
  reason: AgentStopReason
  detail?: string
  finish?: string // provider finish reason, e.g. 'stop', 'length', 'tool-calls', 'content-filter', 'error'
}
