import type { SubagentRecord } from '@/types/harness/subagent-record'
import buildSubagentLedger from './build-subagent-ledger'

const displayName = (record: SubagentRecord): string =>
  record.agentName.trim() || record.subagentId

export default (summary: string, records: SubagentRecord[]): string => {
  if (records.length === 0) {
    return summary
  }

  const completedLines = records.flatMap((record) => {
    if (record.status !== 'completed' || !record.result) {
      return []
    }
    return [
      `- ${displayName(record)} (${record.subagentId}): ${record.result.summary}`,
    ]
  })

  const sections = [summary, buildSubagentLedger(records)]
  if (completedLines.length > 0) {
    sections.push(['Completed subagent results:', ...completedLines].join('\n'))
  }
  return sections.join('\n\n')
}
