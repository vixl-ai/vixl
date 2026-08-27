import type { ChatStatus } from 'ai'

export default (input: {
  isSubagentView: boolean
  subagentRunning: boolean
  parentStatus: ChatStatus
}): ChatStatus => {
  if (input.isSubagentView) {
    return input.subagentRunning ? 'streaming' : 'ready'
  }
  return input.parentStatus
}
