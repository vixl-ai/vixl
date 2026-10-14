import { throwIfAborted } from '@/services/harness/subagent/generate-support'
import type { NestedStepEmitter } from '@/services/harness/subagent/nested-step-emitter'
import type { HarnessEvent } from '@/types/harness/harness-event'

export type SubagentStreamPart = {
  type: string
  text?: string
  error?: unknown
}

export type ConsumeSubagentStreamArgs = {
  fullStream: AsyncIterable<SubagentStreamPart>
  signal: AbortSignal
  steps: NestedStepEmitter
  emitNestedEvent: (event: HarnessEvent) => void
}

export const asStreamError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('Model stream failed')

export const consumeSubagentStream = async (
  args: ConsumeSubagentStreamArgs,
): Promise<void> => {
  const { fullStream, signal, steps, emitNestedEvent } = args
  for await (const part of fullStream) {
    if (signal.aborted) {
      break
    }
    if (part.type === 'start-step') {
      steps.beginStep()
      continue
    }
    if (part.type === 'finish-step') {
      steps.finishStep()
      continue
    }
    if (part.type === 'reasoning-delta') {
      const delta = part.text ?? ''
      steps.ensureStepOpen()
      steps.noteReasoningDelta()
      steps.appendReasoning(delta)
      emitNestedEvent({
        type: 'reasoning-delta',
        delta,
        stepId: steps.currentStepId,
      })
      continue
    }
    if (part.type === 'text-delta') {
      const delta = part.text ?? ''
      steps.ensureStepOpen()
      steps.sealReasoningDuration()
      steps.appendText(delta)
      emitNestedEvent({
        type: 'text-delta',
        delta,
        stepId: steps.currentStepId,
      })
      continue
    }
    if (part.type === 'error') {
      if (signal.aborted) {
        break
      }
      throw asStreamError(part.error)
    }
  }

  if (steps.stepOpen) {
    steps.finishStep()
  }
  throwIfAborted(signal)
}

export default consumeSubagentStream
