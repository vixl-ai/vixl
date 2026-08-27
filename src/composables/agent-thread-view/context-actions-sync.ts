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
  state.contextActions.register({
    onCompact: () => {
      handlers.handleCompact().catch((error) => {
        toast.error('Failed to compact chat', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    },
    onHandoff: () => {
      handlers.handleHandoff().catch((error) => {
        toast.error('Failed to hand off chat', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    },
  })
  state.contextActions.setDisabled({
    triggerDisabled: !state.threadReady.value,
    actionsDisabled: !state.threadReady.value,
  })
}
