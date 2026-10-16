import type { SubagentResult } from '@/types/harness/subagent-record'
import { getSubagent } from '@/services/harness/subagent/registry'

export default (item: { result: SubagentResult }): boolean => {
  const live = getSubagent(item.result.subagentId)?.result
  if (!live) {
    return false
  }
  return (
    live.subagentId === item.result.subagentId &&
    live.name === item.result.name &&
    live.summary === item.result.summary
  )
}
