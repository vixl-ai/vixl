import type { SubagentRecord, SubagentResult } from '@/types/harness/subagent-record'

type CompletionWaiter = (result: SubagentResult) => void

const completionWaiters = new Map<string, CompletionWaiter[]>()

export const resolveCompletionWaiters = (
  subagentId: string,
  result: SubagentResult,
): void => {
  const waiters = completionWaiters.get(subagentId) ?? []
  completionWaiters.delete(subagentId)
  for (const resolve of waiters) {
    resolve(result)
  }
}

export const waitForSubagent = (
  record: SubagentRecord | null,
  chatId: string,
  subagentId: string,
): Promise<SubagentResult> => {
  if (!record || record.chatId !== chatId) {
    return Promise.reject(new Error(`Subagent not found: ${subagentId}`))
  }

  if (record.status !== 'running' && record.result) {
    return Promise.resolve(record.result)
  }

  return new Promise((resolvePromise) => {
    const waiters = completionWaiters.get(subagentId) ?? []
    waiters.push(resolvePromise)
    completionWaiters.set(subagentId, waiters)
  })
}

export const resetCompletionWaitersForTests = (): void => {
  completionWaiters.clear()
}
