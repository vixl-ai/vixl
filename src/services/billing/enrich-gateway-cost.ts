import { toast } from 'vue-sonner'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { ChatUsageTotals } from '@/types/chat/chat-meta'
import billableUsageRecordSchema from '@/schemas/billing/billable-usage-record-schema'
import computeChatUsageTotals from '@/services/billing/compute-chat-usage-totals'
import isGatewayGenerationPending from '@/services/billing/is-gateway-generation-pending'
import readUsageLedger from '@/services/billing/read-usage-ledger'
import {
  updateChatMeta,
  writeChatUsage,
} from '@/services/vixl/vixl-tauri'

/** Waits between getGenerationInfo attempts when the usage event is still pending. */
const RETRY_DELAYS_MS = [2000, 2000, 4000] as const

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const unchanged = (
  current: BillableUsageRecord,
  records: BillableUsageRecord[],
): EnrichGatewayCostResult => ({
  record: current,
  records,
  usageTotals: computeChatUsageTotals(records),
})

const softPending = (
  records: BillableUsageRecord[],
): EnrichGatewayCostResult => ({
  record: null,
  records,
  usageTotals: null,
})

type GatewayGenerationClient = {
  getGenerationInfo: (params: {
    id: string
  }) => Promise<{
    totalCost: number
    upstreamInferenceCost: number
    isByok: boolean
  }>
}

type EnrichGatewayCostResult = {
  record: BillableUsageRecord | null
  records: BillableUsageRecord[]
  usageTotals: ChatUsageTotals | null
}

/**
 * Async cost enrich for AI Gateway generations via getGenerationInfo.
 * Retries briefly when the usage event is not ready yet. Does not modify
 * token fields. Pending after retries: leave ledger unchanged, no toast.
 * Hard failure: toast, leave cost / pricingSource as recorded.
 */
export default async (input: {
  projectSlug: string
  chatId: string
  recordId: string
  generationId: string
  gatewayClient: GatewayGenerationClient
  delay?: (ms: number) => Promise<void>
}): Promise<EnrichGatewayCostResult> => {
  const delay = input.delay ?? defaultDelay
  const records = await readUsageLedger(input.projectSlug, input.chatId)
  const index = records.findIndex((entry) => entry.id === input.recordId)
  if (index < 0) {
    return { record: null, records, usageTotals: null }
  }

  const current = records[index]
  if (!current) {
    return { record: null, records, usageTotals: null }
  }

  const maxAttempts = RETRY_DELAYS_MS.length + 1

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const waitMs = RETRY_DELAYS_MS[attempt - 1]
      if (waitMs !== undefined) {
        await delay(waitMs)
      }
    }

    try {
      const info = await input.gatewayClient.getGenerationInfo({
        id: input.generationId,
      })

      // Non-BYOK: totalCost is the billed gateway amount (includes surcharges).
      // BYOK: totalCost excludes provider inference; upstreamInferenceCost is the
      // market inference price paid via the user key. Prefer upstream for BYOK.
      const costUSD = info.isByok ? info.upstreamInferenceCost : info.totalCost

      const patched: BillableUsageRecord = {
        ...current,
        costUSD,
        pricingSource: 'provider_reported',
      }
      // Drop user_configured rates once provider cost wins.
      delete patched.rates

      const next = [...records]
      next[index] = billableUsageRecordSchema.parse(patched)

      await writeChatUsage(input.projectSlug, input.chatId, next)

      const usageTotals = computeChatUsageTotals(next)
      await updateChatMeta(input.projectSlug, input.chatId, { usageTotals })

      return { record: patched, records: next, usageTotals }
    } catch (error) {
      const canRetry =
        isGatewayGenerationPending(error) && attempt < maxAttempts - 1
      if (canRetry) {
        continue
      }
      if (isGatewayGenerationPending(error)) {
        // Still pending after retries: leave ledger unchanged, no toast.
        return softPending(records)
      }

      toast.error('Failed to load gateway cost', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      return unchanged(current, records)
    }
  }

  return softPending(records)
}
