import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import billableUsageRecordSchema from '@/schemas/billing/billable-usage-record-schema'
import {
  getUserVixlDir,
  readJsonFile,
} from '@/services/vixl/vixl-tauri'

const ledgerPath = async (
  projectSlug: string,
  chatId: string,
): Promise<string> => {
  const root = await getUserVixlDir()
  return `${root}/chats/${projectSlug}/${chatId}/usage-ledger.json`
}

/**
 * Read the append-only usage ledger for a chat.
 * Stored beside meta.json / messages.jsonl under the chat directory.
 * Absent files yield {} from readJsonFile; treat non-arrays as empty.
 */
export default async (
  projectSlug: string,
  chatId: string,
): Promise<BillableUsageRecord[]> => {
  const raw = await readJsonFile(await ledgerPath(projectSlug, chatId))
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
