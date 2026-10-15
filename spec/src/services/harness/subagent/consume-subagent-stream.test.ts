import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NestedStepEmitter } from '@/services/harness/subagent/nested-step-emitter'
import consumeSubagentStream from '@/services/harness/subagent/consume-subagent-stream'
import type { HarnessEvent } from '@/types/harness/harness-event'

const makeSteps = (): NestedStepEmitter =>
  ({
    currentStepId: 's1',
    stepOpen: false,
    beginStep: vi.fn<() => void>(),
    finishStep: vi.fn<() => void>(),
    ensureStepOpen: vi.fn<() => void>(),
    sealReasoningDuration: vi.fn<() => void>(),
    noteModelRequested: vi.fn<() => void>(),
    noteReasoningDelta: vi.fn<() => void>(),
    appendReasoning: vi.fn<(delta: string) => void>(),
    appendText: vi.fn<(delta: string) => void>(),
    dropUnsealed: vi.fn<() => void>(),
  }) as NestedStepEmitter

describe('consumeSubagentStream delta yield', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits each delta immediately and yields once after 50ms of continuous deltas', async () => {
    const steps = makeSteps()
    const emitNestedEvent = vi.fn<(event: HarnessEvent) => void>()
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const promise = consumeSubagentStream({
      fullStream: (async function* () {
        yield { type: 'reasoning-delta', text: 'a' }
        yield { type: 'reasoning-delta', text: 'b' }
        vi.setSystemTime(50)
        yield { type: 'reasoning-delta', text: 'c' }
        yield { type: 'text-delta', text: 'd' }
      })(),
      signal: new AbortController().signal,
      steps,
      emitNestedEvent,
    })

    await vi.advanceTimersByTimeAsync(0)
    await promise

    expect(steps.appendReasoning).toHaveBeenCalledTimes(3)
    expect(steps.appendText).toHaveBeenCalledTimes(1)
    expect(emitNestedEvent.mock.calls.map((call) => call[0])).toEqual([
      { type: 'reasoning-delta', delta: 'a', stepId: 's1' },
      { type: 'reasoning-delta', delta: 'b', stepId: 's1' },
      { type: 'reasoning-delta', delta: 'c', stepId: 's1' },
      { type: 'text-delta', delta: 'd', stepId: 's1' },
    ])
    const zeroDelays = timeoutSpy.mock.calls.filter((call) => call[1] === 0)
    expect(zeroDelays).toHaveLength(1)
  })
})
