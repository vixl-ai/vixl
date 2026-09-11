import type { AgentHarnessState } from './types'

export default (state: AgentHarnessState): boolean => {
  if (state.disposed.value) {
    return false
  }
  return state.chatStore.isSessionActive(state.options.projectSlug, state.options.chatId)
}
