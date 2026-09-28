import { toast } from 'vue-sonner'
import type { AgentThreadViewState } from './types'

export const createContinueHandler = (state: AgentThreadViewState) => {
  return async (): Promise<void> => {
    if (state.isSubagentView.value) {
      return
    }
    if (!state.harness.value) {
      toast.error('Chat is not ready yet', {
        description: 'Wait for the chat to finish loading.',
      })
      return
    }
    const lastRun = state.harness.value.lastRunConfig.value
    const model =
      lastRun?.model ?? state.paintedSession.value?.meta.value?.model
    const mode =
      lastRun?.mode ?? state.paintedSession.value?.meta.value?.mode ?? 'agent'
    if (!model) {
      toast.error('Select a model before continuing')
      return
    }
    await state.harness.value.continueLastTurn({
      mode,
      model,
      reasoning: lastRun?.reasoning,
    })
  }
}
