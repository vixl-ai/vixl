import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessEvent } from '@/types/harness/harness-event'

const persistStepBoundary = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const persistStepText = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const persistTodoUpdate = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const persistToolRun = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistStepBoundary: (...args: unknown[]) => persistStepBoundary(...args),
  persistStepText: (...args: unknown[]) => persistStepText(...args),
  persistTodoUpdate: (...args: unknown[]) => persistTodoUpdate(...args),
  persistToolRun: (...args: unknown[]) => persistToolRun(...args),
}))

import createStreamSteps from '@/services/harness/orchestrator/stream-steps'

describe('stream-steps live workspace persist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists with the new slug after workspace.projectSlug changes', async () => {
    const workspace = {
      projectSlug: '_home_',
      projectRoot: '/home',
      projectName: 'Home',
    }
    const onEvent = vi.fn<(event: HarnessEvent) => void>()
    const steps = createStreamSteps({
      workspace,
      chatId: 'chat-1',
      onEvent,
    })

    workspace.projectSlug = 'dest'
    workspace.projectRoot = '/tmp/dest'
    workspace.projectName = 'Dest'
    await steps.beginStep()

    expect(persistStepBoundary).toHaveBeenCalledWith(
      'dest',
      'chat-1',
      expect.any(String),
      'start',
    )
    expect(persistStepBoundary).not.toHaveBeenCalledWith(
      '_home_',
      'chat-1',
      expect.anything(),
      expect.anything(),
    )
  })
})

describe('stream-steps reasoning duration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const makeSteps = () => {
    const onEvent = vi.fn<(event: HarnessEvent) => void>()
    const steps = createStreamSteps({
      workspace: {
        projectSlug: 'proj',
        projectRoot: '/proj',
        projectName: 'Proj',
      },
      chatId: 'chat-1',
      onEvent,
    })
    return { steps, onEvent }
  }

  const durationEvents = (onEvent: ReturnType<typeof vi.fn>): HarnessEvent[] =>
    onEvent.mock.calls
      .map((call) => call[0])
      .filter((event) => event.type === 'reasoning-duration')

  it('starts the clock on the first reasoning delta and seals with ceil seconds', async () => {
    const { steps, onEvent } = makeSteps()
    await steps.beginStep()
    const stepId = steps.currentStepId
    steps.noteReasoningDelta()
    steps.noteReasoningDelta()
    vi.setSystemTime(1500)
    steps.sealReasoningDuration()

    expect(durationEvents(onEvent)).toEqual([
      { type: 'reasoning-duration', stepId, seconds: 2 },
    ])
    expect(steps.sealedReasoningSeconds).toBe(2)
  })

  it('uses Math.max(1, ceil) so sub-second reasoning is 1 second', async () => {
    const { steps, onEvent } = makeSteps()
    await steps.beginStep()
    const stepId = steps.currentStepId
    steps.noteReasoningDelta()
    vi.setSystemTime(1)
    steps.sealReasoningDuration()

    expect(durationEvents(onEvent)).toEqual([
      { type: 'reasoning-duration', stepId, seconds: 1 },
    ])
  })

  it('seals once on text delta, tool start, and step finish', async () => {
    const { steps, onEvent } = makeSteps()
    await steps.beginStep()
    const firstId = steps.currentStepId
    steps.noteReasoningDelta()
    vi.setSystemTime(1000)
    steps.sealReasoningDuration()
    steps.sealReasoningDuration()
    await steps.emitToolStart('tool-1', 'read_file', { path: 'a.ts' })
    await steps.finishStep()

    expect(durationEvents(onEvent)).toEqual([
      { type: 'reasoning-duration', stepId: firstId, seconds: 1 },
    ])
    expect(steps.sealedReasoningSeconds).toBe(1)
  })

  it('seals from emitToolStart when reasoning has started', async () => {
    const { steps, onEvent } = makeSteps()
    await steps.beginStep()
    const stepId = steps.currentStepId
    steps.noteReasoningDelta()
    vi.setSystemTime(2500)
    await steps.emitToolStart('tool-1', 'read_file', { path: 'a.ts' })
    await steps.emitToolStart('tool-1', 'read_file', { path: 'a.ts' })

    expect(durationEvents(onEvent)).toEqual([
      { type: 'reasoning-duration', stepId, seconds: 3 },
    ])
    expect(steps.sealedReasoningSeconds).toBe(3)
  })

  it('seals from finishStep when reasoning has started', async () => {
    const { steps, onEvent } = makeSteps()
    await steps.beginStep()
    const stepId = steps.currentStepId
    steps.noteReasoningDelta()
    vi.setSystemTime(4000)
    await steps.finishStep()

    expect(durationEvents(onEvent)).toEqual([
      { type: 'reasoning-duration', stepId, seconds: 4 },
    ])
    expect(steps.sealedReasoningSeconds).toBe(4)
  })

  it('resets the clock in beginStep and sums sealed step durations', async () => {
    const { steps, onEvent } = makeSteps()
    await steps.beginStep()
    const firstId = steps.currentStepId
    steps.noteReasoningDelta()
    vi.setSystemTime(2000)
    await steps.beginStep()
    const secondId = steps.currentStepId
    steps.noteReasoningDelta()
    vi.setSystemTime(3500)
    await steps.finishStep()

    expect(durationEvents(onEvent)).toEqual([
      { type: 'reasoning-duration', stepId: firstId, seconds: 2 },
      { type: 'reasoning-duration', stepId: secondId, seconds: 2 },
    ])
    expect(steps.sealedReasoningSeconds).toBe(4)
  })

  it('does not emit or count when a step never received reasoning', async () => {
    const { steps, onEvent } = makeSteps()
    await steps.beginStep()
    await steps.finishStep()

    expect(durationEvents(onEvent)).toEqual([])
    expect(steps.sealedReasoningSeconds).toBe(0)
  })
})
