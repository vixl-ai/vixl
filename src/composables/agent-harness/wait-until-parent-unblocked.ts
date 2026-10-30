import { watch } from 'vue'
import type { AgentHarnessState } from './types'

export default (state: AgentHarnessState, signal?: AbortSignal): Promise<void> => {
  const isDone = (): boolean =>
    Boolean(signal?.aborted) ||
    state.disposed.value ||
    (!state.compacting.value && !state.resumingBackgroundBatch.value)

  if (isDone()) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      stopWatch()
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const stopWatch = watch(
      [state.compacting, state.resumingBackgroundBatch, state.disposed],
      () => {
        if (isDone()) {
          finish()
        }
      },
    )
    signal?.addEventListener('abort', finish)
  })
}
