import type { SubagentRecord, SubagentResult } from '@/types/harness/subagent-record'
import { isBackgroundResultDelivered } from '@/services/harness/subagent/background-result-sets'

const blockingOriginSubagents = new Set<string>()
const reopenedBlockingOriginSubagents = new Set<string>()

export const isBlockingOriginSubagent = (subagentId: string): boolean =>
  blockingOriginSubagents.has(subagentId)

export const classifySubagentOrigin = (
  subagentId: string,
  blocking: boolean,
): void => {
  if (blocking) {
    blockingOriginSubagents.add(subagentId)
    reopenedBlockingOriginSubagents.delete(subagentId)
    return
  }
  blockingOriginSubagents.delete(subagentId)
  reopenedBlockingOriginSubagents.delete(subagentId)
}

export const markBlockingOriginReopened = (subagentId: string): void => {
  if (blockingOriginSubagents.has(subagentId)) {
    reopenedBlockingOriginSubagents.add(subagentId)
  }
}

export const forgetBlockingOriginSubagent = (subagentId: string): void => {
  blockingOriginSubagents.delete(subagentId)
  reopenedBlockingOriginSubagents.delete(subagentId)
}

export const resetBlockingOriginSetsForTests = (): void => {
  blockingOriginSubagents.clear()
  reopenedBlockingOriginSubagents.clear()
}

export const listDeliverableResults = (
  chatId: string,
  records: SubagentRecord[],
  isBackground: (subagentId: string) => boolean,
): Array<{ toolCallId: string; result: SubagentResult }> =>
  records.flatMap((record) =>
    (isBackground(record.subagentId) ||
      reopenedBlockingOriginSubagents.has(record.subagentId)) &&
    (record.status === 'completed' || record.status === 'failed') &&
    record.result &&
    !isBackgroundResultDelivered(chatId, record.toolCallId)
      ? [{ toolCallId: record.toolCallId, result: record.result }]
      : [],
  )
