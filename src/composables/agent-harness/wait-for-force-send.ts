import { watch } from 'vue'
import waitUntilParentUnblocked from './wait-until-parent-unblocked'
import type { AgentHarnessState } from './types'

export const waitUntilForceSendParentIdle = async (
  state: AgentHarnessState,
): Promise<void> => {
  const isBusyStatus = (): boolean =>
    state.status.value === 'streaming' || state.status.value === 'submitted'
  const isIdle = (): boolean =>
    state.disposed.value ||
    (!isBusyStatus() &&
      !state.compacting.value &&
      !state.resumingBackgroundBatch.value)

  while (!isIdle()) {
    if (state.compacting.value || state.resumingBackgroundBatch.value) {
      await waitUntilParentUnblocked(state)
    }
    if (
      !state.disposed.value &&
      isBusyStatus() &&
      !state.compacting.value &&
      !state.resumingBackgroundBatch.value
    ) {
      await new Promise<void>((resolve) => {
        const shouldWake = (): boolean =>
          state.disposed.value ||
          !isBusyStatus() ||
          state.compacting.value ||
          state.resumingBackgroundBatch.value
        const stopWatch = watch(
          [
            state.status,
            state.compacting,
            state.resumingBackgroundBatch,
            state.disposed,
          ],
          () => {
            if (shouldWake()) {
              stopWatch()
              resolve()
            }
          },
        )
        if (shouldWake()) {
          stopWatch()
          resolve()
        }
      })
    }
  }
}

export const waitOutForceSendOverlap = async (args: {
  state: AgentHarnessState
  controller: AbortController
  previousAbort: AbortController | null
}): Promise<boolean> => {
  const { state, controller, previousAbort } = args
  while (
    !state.disposed.value &&
    !controller.signal.aborted &&
    (state.resumingBackgroundBatch.value || state.compacting.value)
  ) {
    await waitUntilParentUnblocked(state, controller.signal)
  }
  if (state.disposed.value || controller.signal.aborted) {
    state.status.value = 'ready'
    if (state.abortController.value === controller) {
      state.abortController.value = previousAbort
    }
    return true
  }
  state.abortController.value = controller
  return false
}

export const forceSendSkippedAtStart = async (
  state: AgentHarnessState,
  queuedItemId: string | undefined,
): Promise<boolean> => {
  if (queuedItemId == null) {
    return false
  }
  await waitUntilForceSendParentIdle(state)
  return state.disposed.value
}

export const forceSendSkippedBeforeAppend = async (args: {
  queuedItemId: string | undefined
  state: AgentHarnessState
  controller: AbortController
  previousAbort: AbortController | null
}): Promise<boolean> => {
  if (args.queuedItemId == null) {
    return false
  }
  return waitOutForceSendOverlap({
    state: args.state,
    controller: args.controller,
    previousAbort: args.previousAbort,
  })
}

export const forceSendSkippedAfterAppend = async (args: {
  queuedItemId: string | undefined
  userMessageAppended: boolean
  state: AgentHarnessState
  controller: AbortController
  previousAbort: AbortController | null
}): Promise<boolean> => {
  if (args.controller.signal.aborted) {
    if (args.queuedItemId != null && args.userMessageAppended) {
      args.state.messageQueue.remove(args.queuedItemId)
    }
    args.state.status.value = 'ready'
    return true
  }
  if (args.queuedItemId == null) {
    return false
  }
  if (
    await waitOutForceSendOverlap({
      state: args.state,
      controller: args.controller,
      previousAbort: args.previousAbort,
    })
  ) {
    if (args.userMessageAppended && args.controller.signal.aborted) {
      args.state.messageQueue.remove(args.queuedItemId)
    }
    return true
  }
  return false
}

export const withParentSendInFlight = async <T>(
  state: AgentHarnessState,
  run: () => Promise<T>,
): Promise<T> => {
  const box = state.parentSendInFlight
  let releaseInFlight = (): void => {}
  let tracked: Promise<void> | null = null
  if (box) {
    let released = false
    tracked = new Promise<void>((resolve) => {
      releaseInFlight = () => {
        if (released) {
          return
        }
        released = true
        resolve()
      }
    })
    box.current = tracked
  }
  try {
    return await run()
  } finally {
    releaseInFlight()
    if (box && box.current === tracked) {
      box.current = null
    }
  }
}
