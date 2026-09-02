import type { LastStepUsage } from '@/composables/use-context-usage'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'

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

export default (record: BillableUsageRecord): LastStepUsage | null => {
  if (record.source !== 'main' || !recordHasTokens(record)) {
    return null
  }

  const usage = record.usage
  const inputTokens = usage.inputTokens ?? 0
  return {
    promptTokens: inputTokens,
    inputTokens,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}
