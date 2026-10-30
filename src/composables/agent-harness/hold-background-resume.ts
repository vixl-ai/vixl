import type { AgentHarnessState } from './types'

const epochs = new WeakMap<object, number>()

export const claimBackgroundResumeHold = (state: AgentHarnessState): number => {
  const epoch = (epochs.get(state) ?? 0) + 1
  epochs.set(state, epoch)
  state.holdBackgroundResume.value = true
  return epoch
}

export const backgroundResumeHoldEpoch = (state: AgentHarnessState): number =>
  epochs.get(state) ?? 0

export const clearBackgroundResumeHold = (
  state: AgentHarnessState,
  epoch: number,
): boolean => {
  if ((epochs.get(state) ?? 0) !== epoch) {
    return false
  }
  if (!state.holdBackgroundResume.value) {
    return false
  }
  state.holdBackgroundResume.value = false
  return true
}
