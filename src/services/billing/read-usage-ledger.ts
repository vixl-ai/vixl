import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import billableUsageRecordSchema from '@/schemas/billing/billable-usage-record-schema'
import { readChatUsage } from '@/services/vixl/vixl-tauri'

/**
 * Read the append-only usage ledger for a chat.
 * Stored in sqlite chat_usage_rows. Invalid records are skipped.
 */
export default async (
  projectSlug: string,
  chatId: string,
): Promise<BillableUsageRecord[]> => {
  const raw = await readChatUsage(projectSlug, chatId)
  if (!Array.isArray(raw)) {
    return []
  }

  const records: BillableUsageRecord[] = []
  for (const entry of raw) {
    const parsed = billableUsageRecordSchema.safeParse(entry)
    if (parsed.success) {
      records.push(parsed.data)
    }
  }
  return records
}
