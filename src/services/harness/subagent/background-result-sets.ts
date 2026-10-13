const addIds = (
  store: Map<string, Set<string>>,
  chatId: string,
  toolCallIds: string[],
): void => {
  if (toolCallIds.length === 0) {
    return
  }
  const existing = store.get(chatId) ?? new Set<string>()
  for (const toolCallId of toolCallIds) {
    existing.add(toolCallId)
  }
  store.set(chatId, existing)
}

const deliveredBackgroundResults = new Map<string, Set<string>>()
const finalizedBackgroundResults = new Map<string, Set<string>>()

export const isBackgroundResultDelivered = (
  chatId: string,
  toolCallId: string,
): boolean => deliveredBackgroundResults.get(chatId)?.has(toolCallId) === true

export const markBackgroundResultsDelivered = (
  chatId: string,
  toolCallIds: string[],
): void => {
  addIds(deliveredBackgroundResults, chatId, toolCallIds)
}

export const isBackgroundResultFinalized = (
  chatId: string,
  toolCallId: string,
): boolean => finalizedBackgroundResults.get(chatId)?.has(toolCallId) === true

export const markBackgroundResultsFinalized = (
  chatId: string,
  toolCallIds: string[],
): void => {
  addIds(finalizedBackgroundResults, chatId, toolCallIds)
}

export const forgetBackgroundResultTracking = (
  chatId: string,
  toolCallId?: string,
): void => {
  if (toolCallId === undefined) {
    deliveredBackgroundResults.delete(chatId)
    finalizedBackgroundResults.delete(chatId)
    return
  }
  deliveredBackgroundResults.get(chatId)?.delete(toolCallId)
  finalizedBackgroundResults.get(chatId)?.delete(toolCallId)
}

export const resetBackgroundResultSetsForTests = (): void => {
  deliveredBackgroundResults.clear()
  finalizedBackgroundResults.clear()
}
