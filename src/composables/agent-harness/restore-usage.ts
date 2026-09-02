import { toast } from 'vue-sonner'
import type { LastStepUsage } from '@/composables/use-context-usage'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { TurnUsageAggregate } from '@/types/billing/turn-usage-aggregate'
import aggregateTurnUsage from '@/services/billing/aggregate-turn-usage'
import readUsageLedger from '@/services/billing/read-usage-ledger'
import lastStepUsageFromRecord from './last-step-usage-from-record'
import type { AgentHarnessState } from './types'

const latestMainLastStep = (records: BillableUsageRecord[]): LastStepUsage | null => {
  let latestAt: string | null = null
  let lastStep: LastStepUsage | null = null
  for (const record of records) {
    const mapped = lastStepUsageFromRecord(record)
    if (!mapped) {
      continue
    }
    if (!latestAt || record.at >= latestAt) {
      latestAt = record.at
      lastStep = mapped
    }
  }
  return lastStep
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

      const lastStep = latestMainLastStep(merged)
      const isActive = chatStore.isSessionActive(options.projectSlug, options.chatId)
      if (!lastStep || !isActive || status.value !== 'ready') {
        return
      }

      contextUsage.setLastStepUsage(lastStep)
    } catch (error) {
      toast.error('Failed to restore usage', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return { restoreUsageLedger }
}
