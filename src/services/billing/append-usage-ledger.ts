import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { ChatUsageTotals } from '@/types/chat/chat-meta'
import billableUsageRecordSchema from '@/schemas/billing/billable-usage-record-schema'
import computeChatUsageTotals from '@/services/billing/compute-chat-usage-totals'
import readUsageLedger from '@/services/billing/read-usage-ledger'
import {
  getUserVixlDir,
  updateChatMeta,
  writeJsonFile,
} from '@/services/vixl/vixl-tauri'

const ledgerPath = async (
  projectSlug: string,
  chatId: string,
): Promise<string> => {
  const root = await getUserVixlDir()
  return `${root}/chats/${projectSlug}/${chatId}/usage-ledger.json`
}

export type AppendUsageLedgerResult = {
  records: BillableUsageRecord[]
  usageTotals: ChatUsageTotals
}

/**
 * Append a billable usage record to the chat ledger (full snapshot including raw).
 * Recomputes ChatMeta.usageTotals from the ledger and persists the rollup.
 */
export default async (
  projectSlug: string,
  chatId: string,
  record: BillableUsageRecord,
): Promise<AppendUsageLedgerResult> => {
  const validated = billableUsageRecordSchema.parse(record)
  const existing = await readUsageLedger(projectSlug, chatId)
  const records = [...existing, validated]

  await writeJsonFile(await ledgerPath(projectSlug, chatId), records)

  const usageTotals = computeChatUsageTotals(records)
  await updateChatMeta(projectSlug, chatId, { usageTotals })

  return { records, usageTotals }
}
