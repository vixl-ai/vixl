import type { SubagentRecord } from '@/types/harness/subagent-record'

export type SubagentLedgerRecord = Pick<
  SubagentRecord,
  'agentName' | 'subagentId' | 'status'
>

export default (records: SubagentLedgerRecord[]): string => {
  const lines = records.map((record) => {
    const name = record.agentName.trim() || record.subagentId
    return `- ${name} (${record.subagentId}): ${record.status}`
  })
  return ['Subagent ledger:', ...lines].join('\n')
}
