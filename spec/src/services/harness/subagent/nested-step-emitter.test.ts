import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessEvent } from '@/types/harness/harness-event'
import { createNestedStepEmitter } from '@/services/harness/subagent/nested-step-emitter'

describe('nested-step-emitter reasoning duration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const makeSteps = () => {
    const onEvent = vi.fn<(event: HarnessEvent) => void>()
    const steps = createNestedStepEmitter(onEvent)
    return { steps, onEvent }
  }

  const durationEvents = (onEvent: ReturnType<typeof vi.fn>): HarnessEvent[] =>
    onEvent.mock.calls
      .map((call) => call[0])
      .filter((event) => event.type === 'reasoning-duration')

  it('uses a request stamp 13s before the first delta', () => {
    const { steps, onEvent } = makeSteps()
    steps.noteModelRequested()
    steps.beginStep()
    const stepId = steps.currentStepId
    vi.setSystemTime(13_000)
    steps.noteReasoningDelta()
    steps.sealReasoningDuration()

    expect(durationEvents(onEvent)).toEqual([
      { type: 'reasoning-duration', stepId, seconds: 13 },
    ])
  })

  it('seals a same-tick burst with no earlier stamp as 1 second', () => {
    const { steps, onEvent } = makeSteps()
    steps.beginStep()
    const stepId = steps.currentStepId
    steps.noteReasoningDelta()
    steps.sealReasoningDuration()

    expect(durationEvents(onEvent)).toEqual([
      { type: 'reasoning-duration', stepId, seconds: 1 },
    ])
  })

  it('keeps a pre-beginStep stamp and replaces it on a later request', () => {
    const { steps, onEvent } = makeSteps()
    steps.noteModelRequested()
    vi.setSystemTime(5_000)
    steps.beginStep()
    const firstId = steps.currentStepId
    steps.noteReasoningDelta()
    vi.setSystemTime(8_000)
    steps.finishStep()

    steps.noteModelRequested()
    vi.setSystemTime(20_000)
    steps.beginStep()
    const secondId = steps.currentStepId
    steps.noteReasoningDelta()
    steps.sealReasoningDuration()

    expect(durationEvents(onEvent)).toEqual([
      { type: 'reasoning-duration', stepId: firstId, seconds: 8 },
      { type: 'reasoning-duration', stepId: secondId, seconds: 12 },
    ])
  })

  it('emits no reasoning-duration when a step has no reasoning', () => {
    const { steps, onEvent } = makeSteps()
    steps.noteModelRequested()
    steps.beginStep()
    steps.finishStep()

    expect(durationEvents(onEvent)).toEqual([])
  })
})
