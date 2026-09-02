import { toast } from 'vue-sonner'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { TurnUsageAggregate } from '@/types/billing/turn-usage-aggregate'
import aggregateTurnUsage from '@/services/billing/aggregate-turn-usage'
import readUsageLedger from '@/services/billing/read-usage-ledger'
import type { AgentHarnessState } from './types'

const recordHasTokens = (record: BillableUsageRecord): boolean => {
  const usage = record.usage
  return (
    (usage.inputTokens ?? 0) > 0 ||
    (usage.outputTokens ?? 0) > 0 ||
    (usage.cacheReadTokens ?? 0) > 0 ||
    (usage.cacheWriteTokens ?? 0) > 0 ||
    (usage.noCacheTokens ?? 0) > 0 ||
    (usage.reasoningTokens ?? 0) > 0 ||
    (usage.textTokens ?? 0) > 0 ||
    (usage.totalTokens ?? 0) > 0
  )
}

const latestMainWithTokens = (
  records: BillableUsageRecord[],
): BillableUsageRecord | null => {
  let latest: BillableUsageRecord | null = null
  for (const record of records) {
    if (record.source !== 'main' || !recordHasTokens(record)) {
      continue
    }
    if (!latest || record.at >= latest.at) {
      latest = record
    }
  }
  return latest
}

const mergeRecords = (
  ledger: BillableUsageRecord[],
  live: BillableUsageRecord[],
): BillableUsageRecord[] => {
  const byId = new Map<string, BillableUsageRecord>()
  for (const record of ledger) {
    byId.set(record.id, record)
  }
  for (const record of live) {
    byId.set(record.id, record)
  }
  return [...byId.values()]
}

const aggregatesByTurnId = (
  records: BillableUsageRecord[],
): Record<string, TurnUsageAggregate> => {
  const byTurn: Record<string, TurnUsageAggregate> = {}
  const turnIds = new Set(records.map((record) => record.turnId))
  for (const turnId of turnIds) {
    byTurn[turnId] = aggregateTurnUsage(records, turnId)
  }
  return byTurn
}

export default (state: AgentHarnessState) => {
  const restoreUsageLedger = async (): Promise<void> => {
    const { options, billableUsageRecords, turnUsageByTurnId, contextUsage, chatStore, status } =
      state

    try {
      const ledger = await readUsageLedger(options.projectSlug, options.chatId)
      const merged = mergeRecords(ledger, billableUsageRecords.value)
      billableUsageRecords.value = merged
      turnUsageByTurnId.value = aggregatesByTurnId(merged)

      const latestMain = latestMainWithTokens(merged)
      const isActive = chatStore.isSessionActive(options.projectSlug, options.chatId)
      if (!latestMain || !isActive || status.value !== 'ready') {
        return
      }

      const usage = latestMain.usage
      const inputTokens = usage.inputTokens ?? 0
      const cacheReadTokens = usage.cacheReadTokens ?? 0
      const cacheWriteTokens = usage.cacheWriteTokens ?? 0
      contextUsage.setLastStepUsage({
        promptTokens: inputTokens,
        inputTokens,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
      })
    } catch (error) {
      toast.error('Failed to restore usage', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return { restoreUsageLedger }
}
