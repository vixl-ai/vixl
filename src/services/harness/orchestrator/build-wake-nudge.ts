import { visibleStatus } from '@/services/harness/guidance'
import type { SubagentResult, SubagentStatus } from '@/types/harness/subagent-record'
import buildSubagentLedger, {
  type SubagentLedgerRecord,
} from './build-subagent-ledger'

type WakeNudgeRunningAgent = {
  name: string
  subagentId: string
}

export default (
  completedResults: Array<{
    toolCallId: string
    result: SubagentResult
    status?: SubagentStatus
  }>,
  runningAgents: WakeNudgeRunningAgent[],
  ledger: SubagentLedgerRecord[],
  options?: { summariesInline?: boolean },
): string => {
  const lines = completedResults.map((item) => {
    const name = item.result.name.trim() || item.result.subagentId
    const status = item.status ?? 'completed'
    return `- ${name} (${item.result.subagentId}, ${status}): ${item.result.summary.trim()}`
  })
  const completedBlock = ['Completed:', ...lines]
  const summariesClause = options?.summariesInline
    ? 'Summaries are below.'
    : 'Summaries are in the spawn_subagent tool results above.'
  const body =
    runningAgents.length === 0
      ? `All background subagents have finished. ${summariesClause} Answer the user from those results. ${visibleStatus('finished')}`
      : `A background subagent finished; still running: ${runningAgents
          .map((agent) => `${agent.name} (${agent.subagentId})`)
          .join(', ')}. Either answer about the finished result now or wait for the rest. ${visibleStatus('finished')}`

  return [
    '[harness: background subagent results]',
    'Sent by the vixl harness, not a new user request.',
    '',
    body,
    '',
    ...completedBlock,
    '',
    buildSubagentLedger(ledger),
  ].join('\n')
}
