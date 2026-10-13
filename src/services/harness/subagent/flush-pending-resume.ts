import {
  clearPendingBackgroundResume,
  clearTurnResponseMessages,
  hasRunningSubagentsForChat,
  listDeliverableBackgroundResults,
  markBackgroundResultsDelivered,
} from '@/services/harness/subagent/registry'

export type FlushPendingBackgroundResumeOptions = {
  markDelivered?: boolean
}

const flushPendingBackgroundResume = (
  chatId: string,
  options?: FlushPendingBackgroundResumeOptions,
): void => {
  if (options?.markDelivered !== false) {
    markBackgroundResultsDelivered(
      chatId,
      listDeliverableBackgroundResults(chatId).map((item) => item.toolCallId),
    )
  }
  clearTurnResponseMessages(chatId)
  if (
    !hasRunningSubagentsForChat(chatId) &&
    listDeliverableBackgroundResults(chatId).length === 0
  ) {
    clearPendingBackgroundResume(chatId)
  }
}

export default flushPendingBackgroundResume
