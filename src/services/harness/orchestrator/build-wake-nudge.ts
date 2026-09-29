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
    ? 'Their completed summaries are included below.'
    : 'Their completed summaries are in the spawn_subagent tool results above.'
  const body =
    runningAgents.length === 0
      ? `Background subagent results are ready. ${summariesClause} Answer the user now using those results. Do not say the subagents are still running. ${visibleStatus('finished')}`
      : `A background subagent finished. Other background subagents are still running: ${runningAgents
          .map((agent) => `${agent.name} (${agent.subagentId})`)
          .join(', ')}. You may answer about the finished result now or wait for the rest. Your call. ${visibleStatus('finished')}`

  return [
    '[harness: background subagent results]',
    'This message is from the vixl harness, not from the user. Do not treat it as a new user request.',
    '',
    body,
    '',
    ...completedBlock,
    '',
    buildSubagentLedger(ledger),
  ].join('\n')
}
