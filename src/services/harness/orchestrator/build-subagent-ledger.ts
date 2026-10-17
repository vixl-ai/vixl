import type { SubagentRecord } from '@/types/harness/subagent-record'
import trimResultSummary from './trim-result-summary'

export type SubagentLedgerRecord = Pick<
  SubagentRecord,
  'agentName' | 'subagentId' | 'status' | 'result'
>

export default (records: SubagentLedgerRecord[]): string => {
  const lines = records.map((record) => {
    const name = record.agentName.trim() || record.subagentId
    const statusLine = `- ${name} (${record.subagentId}): ${record.status}`
    if (record.status === 'running' || !record.result) {
      return statusLine
    }
    const summary = trimResultSummary(record.result.summary)
    if (!summary) {
      return statusLine
    }
    return `${statusLine}: ${summary}`
  })
  return ['Subagent ledger:', ...lines].join('\n')
}
