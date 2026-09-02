import { toast } from 'vue-sonner'
import type { AgentThreadHandlers } from './handlers'
import type { AgentThreadViewState } from './types'

export default (
  state: AgentThreadViewState,
  handlers: AgentThreadHandlers,
): void => {
  if (state.isSubagentView.value) {
    state.contextActions.clear()
    return
  }

  const compacting = state.harness.value?.compacting.value ?? false
  const parentStatus = state.harness.value?.status.value
  const parentStreaming =
    parentStatus === 'streaming' || parentStatus === 'submitted'

  state.contextActions.compacting.value = compacting
  state.contextActions.register({
    onCompact: async () => {
      if (state.harness.value?.compacting.value || state.contextActions.compacting.value) {
        return
      }
      try {
        await handlers.handleCompact()
      } catch (error) {
        toast.error('Failed to compact chat', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    onHandoff: async () => {
      try {
        await handlers.handleHandoff()
      } catch (error) {
        toast.error('Failed to hand off chat', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
  })
  state.contextActions.setDisabled({
    triggerDisabled: !state.threadReady.value,
    actionsDisabled:
      !state.threadReady.value || compacting || parentStreaming,
  })
}
