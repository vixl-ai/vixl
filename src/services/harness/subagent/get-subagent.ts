import { tool } from 'ai'
import { z } from 'zod'
import trimResultSummary from '@/services/harness/orchestrator/trim-result-summary'
import { getSubagent as getSubagentRecord } from '@/services/harness/subagent/registry'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { SubagentStatus } from '@/types/harness/subagent-record'

type GetSubagentResult = {
  subagentId: string
  agentName: string
  status: SubagentStatus
  startedAt: string
  model: string | null
  capabilities: 'read-only' | 'write' | null
  summary?: string | null
}

const summaryText = (summary: string | undefined): string | null => {
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    return null
  }
  return trimResultSummary(summary)
}

const getSubagent = (ctx: HarnessToolContext) =>
  tool({
    description:
      'fetch one subagent in this chat. Returns the current status. Pass summary true only when the summary is needed.',
    inputSchema: z.object({
      subagentId: z.string().describe('Id returned by spawn_subagent or get_subagents'),
      summary: z
        .boolean()
        .default(false)
        .describe('Include the trimmed run summary when true'),
    }),
    execute: async ({
      subagentId,
      summary = false,
    }): Promise<GetSubagentResult> => {
      const record = getSubagentRecord(subagentId)
      if (!record || record.chatId !== ctx.chatId) {
        throw new Error(`Unknown subagentId: ${subagentId}`)
      }

      const result: GetSubagentResult = {
        subagentId: record.subagentId,
        agentName: record.agentName,
        status: record.status,
        startedAt: record.startedAt,
        model: record.model ?? null,
        capabilities: record.capabilities ?? null,
      }
      if (!summary) {
        return result
      }
      return {
        ...result,
        summary: summaryText(record.result?.summary),
      }
    },
  })

export default getSubagent
