import { assertNotAwaitingPlanGo } from '@/services/harness/plan-execution-session'
import { pushSteer } from '@/services/harness/subagent/inbox'
import resumeSubagent from '@/services/harness/subagent/resume'
import {
  getSubagent,
  listSubagentsForChat,
} from '@/services/harness/subagent/registry'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const knownIdsLabel = (chatId: string): string => {
  const records = listSubagentsForChat(chatId)
  if (records.length === 0) {
    return '(none)'
  }
  return records
    .map((record) => `${record.subagentId} (${record.agentName}, ${record.status})`)
    .join(', ')
}

const namesMatch = (actual: string, expected: string): boolean =>
  actual.trim().toLowerCase() === expected.trim().toLowerCase()

const deliverSteer = async (
  ctx: HarnessToolContext,
  subagentId: string,
  message: string,
  agentName: string,
): Promise<{
  subagentId: string
  name: string
  status: 'running'
  note: string
}> => {
  assertNotAwaitingPlanGo(ctx.projectSlug, ctx.chatId)

  if (ctx.signal?.aborted) {
    throw new Error('Subagent aborted')
  }

  const record = getSubagent(subagentId)
  if (!record || record.chatId !== ctx.chatId) {
    throw new Error(
      `Unknown subagentId: ${subagentId}. Known subagent ids for this chat: ${knownIdsLabel(ctx.chatId)}`,
    )
  }

  if (!namesMatch(record.agentName, agentName)) {
    throw new Error(
      `Subagent ${subagentId} is "${record.agentName}", not "${agentName}". Known subagents: ${knownIdsLabel(ctx.chatId)}`,
    )
  }

  if (record.status === 'running') {
    pushSteer(subagentId, message)
    return {
      subagentId,
      name: record.agentName,
      status: 'running',
      note: 'Steer will be delivered at the next step boundary.',
    }
  }

  if (record.status === 'completed' || record.status === 'failed') {
    return resumeSubagent(ctx, subagentId, message)
  }

  throw new Error(
    `Subagent ${subagentId} is ${record.status} and cannot be steered.`,
  )
}

export default deliverSteer
