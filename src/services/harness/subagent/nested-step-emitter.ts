import type { HarnessEvent } from '@/types/harness/harness-event'

export type NestedStepEmitter = {
  readonly currentStepId: string
  readonly stepOpen: boolean
  beginStep: () => void
  finishStep: () => void
  ensureStepOpen: () => void
  sealReasoningDuration: () => void
  noteReasoningDelta: () => void
  appendReasoning: (delta: string) => void
  appendText: (delta: string) => void
  dropUnsealed: () => void
}

export const createNestedStepEmitter = (
  emitNestedEvent: (event: HarnessEvent) => void,
): NestedStepEmitter => {
  let currentStepId = ''
  let stepOpen = false
  let currentReasoning = ''
  let currentText = ''
  let currentReasoningSeconds = 0
  let reasoningStartedAt: number | null = null
  let reasoningSealed = false
  let openedStepIds: string[] = []
  const sealedStepIds = new Set<string>()

  const resetReasoningClock = (): void => {
    reasoningStartedAt = null
    reasoningSealed = false
  }

  const sealReasoningDuration = (): void => {
    if (reasoningSealed || !currentStepId) {
      return
    }
    reasoningSealed = true
    if (reasoningStartedAt === null) {
      return
    }
    const elapsedMs = Date.now() - reasoningStartedAt
    const seconds = Math.max(1, Math.ceil(elapsedMs / 1000))
    currentReasoningSeconds = seconds
    emitNestedEvent({ type: 'reasoning-duration', stepId: currentStepId, seconds })
  }

  const finishStep = (): void => {
    if (!stepOpen) {
      return
    }
    sealReasoningDuration()
    emitNestedEvent({
      type: 'step-content',
      stepId: currentStepId,
      reasoning: currentReasoning,
      reasoningSeconds: currentReasoningSeconds,
      text: currentText,
    })
    emitNestedEvent({ type: 'step-finish', stepId: currentStepId })
    sealedStepIds.add(currentStepId)
    stepOpen = false
  }

  const resetOpenStep = (): void => {
    stepOpen = false
    currentStepId = ''
    currentReasoning = ''
    currentText = ''
    currentReasoningSeconds = 0
    resetReasoningClock()
  }

  const dropUnsealed = (): void => {
    const unsealed = openedStepIds.filter((id) => !sealedStepIds.has(id))
    if (unsealed.length === 0) {
      return
    }
    emitNestedEvent({ type: 'step-drop-unsealed', stepIds: unsealed })
    openedStepIds = openedStepIds.filter((id) => sealedStepIds.has(id))
    if (unsealed.includes(currentStepId)) {
      resetOpenStep()
    }
  }

  const beginStep = (): void => {
    if (stepOpen) {
      finishStep()
    }
    currentStepId = crypto.randomUUID()
    currentReasoning = ''
    currentText = ''
    currentReasoningSeconds = 0
    stepOpen = true
    openedStepIds.push(currentStepId)
    resetReasoningClock()
    emitNestedEvent({ type: 'step-start', stepId: currentStepId })
  }

  const ensureStepOpen = (): void => {
    if (!stepOpen) {
      beginStep()
    }
  }

  return {
    get currentStepId() {
      return currentStepId
    },
    get stepOpen() {
      return stepOpen
    },
    beginStep,
    finishStep,
    ensureStepOpen,
    sealReasoningDuration,
    dropUnsealed,
    noteReasoningDelta: (): void => {
      if (reasoningStartedAt === null && !reasoningSealed) {
        reasoningStartedAt = Date.now()
      }
    },
    appendReasoning: (delta: string): void => {
      currentReasoning += delta
    },
    appendText: (delta: string): void => {
      currentText += delta
    },
  }
}

export default createNestedStepEmitter
