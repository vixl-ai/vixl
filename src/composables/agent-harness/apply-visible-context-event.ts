import { toast } from 'vue-sonner'
import type { HarnessEvent } from '@/types/harness/harness-event'
import canWriteVisibleContext from './can-write-visible-context'
import lastStepUsageFromRecord from './last-step-usage-from-record'
import type { AgentHarnessState } from './types'

const refreshVisibleBudget = (state: AgentHarnessState): void => {
  state.contextBudgetSync.refreshContextBudget().catch((error) => {
    toast.error('Failed to refresh context usage', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  })
}

export default (state: AgentHarnessState, event: HarnessEvent): void => {
  if (!canWriteVisibleContext(state)) {
    return
  }

  const { contextUsage } = state

  if (event.type === 'context-budget') {
    contextUsage.setBudget({
      modelId: event.modelId,
      used: event.used,
      promptUsed: event.promptUsed,
      limit: event.limit,
      reservedOutput: event.reservedOutput,
      safetyBuffer: event.safetyBuffer,
      free: event.free,
      buckets: event.buckets,
    })
    return
  }

  if (event.type === 'context-usage') {
    contextUsage.setLastStepUsage({
      promptTokens: event.promptTokens,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheReadTokens: event.cacheReadTokens,
      cacheWriteTokens: event.cacheWriteTokens,
    })
    refreshVisibleBudget(state)
    return
  }

  if (event.type === 'billable-usage') {
    const lastStep = lastStepUsageFromRecord(event.record)
    if (lastStep) {
      contextUsage.setLastStepUsage(lastStep)
    }
    return
  }

  if (event.type === 'compaction') {
    contextUsage.clearLastStepUsage()
    refreshVisibleBudget(state)
  }
}
