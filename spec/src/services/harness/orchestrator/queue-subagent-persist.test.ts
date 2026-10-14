import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessEvent } from '@/types/harness/harness-event'

const persistSubagentHarnessEvent = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const persistPendingSubagent = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistSubagentHarnessEvent: (...args: unknown[]) =>
    persistSubagentHarnessEvent(...args),
  persistPendingSubagent: (...args: unknown[]) => persistPendingSubagent(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() },
}))

import { toast } from 'vue-sonner'
import { createSubagentPersistQueue } from '@/services/harness/orchestrator/queue-subagent-persist'

const startEvent: HarnessEvent = {
  type: 'subagent-start',
  subagentId: 'sub-1',
  toolCallId: 'call-1',
  name: 'explore',
  blocking: true,
}

const nestedEvent: HarnessEvent = {
  type: 'subagent-event',
  subagentId: 'sub-1',
  parentToolCallId: 'call-1',
  event: { type: 'step-start', stepId: 's1' },
}

const pendingEvent: HarnessEvent = {
  type: 'pending-subagent',
  toolCallId: 'call-2',
  subagentId: 'sub-2',
  agentName: 'explore',
  prompt: 'look around',
}

describe('createSubagentPersistQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persistSubagentHarnessEvent.mockResolvedValue(undefined)
    persistPendingSubagent.mockResolvedValue(undefined)
  })

  it('does not start the next persist until the previous write resolves', async () => {
    const started: string[] = []
    const finished: string[] = []
    let releaseFirst = (): void => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    persistSubagentHarnessEvent.mockImplementationOnce(async () => {
      started.push('start')
      await firstGate
      finished.push('start')
    })
    persistSubagentHarnessEvent.mockImplementationOnce(async () => {
      started.push('event')
      finished.push('event')
    })

    const queue = createSubagentPersistQueue('proj', 'chat-1')
    const onEvent = vi.fn<(event: HarnessEvent) => void>()
    queue.handle(startEvent, onEvent)
    queue.handle(nestedEvent, onEvent)

    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenNthCalledWith(1, startEvent)
    expect(onEvent).toHaveBeenNthCalledWith(2, nestedEvent)

    await Promise.resolve()
    expect(started).toEqual(['start'])
    expect(finished).toEqual([])
    expect(persistSubagentHarnessEvent).toHaveBeenCalledTimes(1)

    releaseFirst()
    await queue.flush()
    expect(started).toEqual(['start', 'event'])
    expect(finished).toEqual(['start', 'event'])
    expect(persistSubagentHarnessEvent).toHaveBeenNthCalledWith(
      1,
      'proj',
      'chat-1',
      startEvent,
    )
    expect(persistSubagentHarnessEvent).toHaveBeenNthCalledWith(
      2,
      'proj',
      'chat-1',
      nestedEvent,
    )
  })

  it('queues pending-subagent on the same chain as harness events', async () => {
    const order: string[] = []
    let releaseFirst = (): void => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    persistSubagentHarnessEvent.mockImplementationOnce(async () => {
      order.push('start-begin')
      await firstGate
      order.push('start-end')
    })
    persistPendingSubagent.mockImplementationOnce(async () => {
      order.push('pending')
    })

    const queue = createSubagentPersistQueue('proj', 'chat-1')
    queue.handle(startEvent, () => undefined)
    queue.handle(pendingEvent, () => undefined)

    await Promise.resolve()
    expect(order).toEqual(['start-begin'])
    expect(persistPendingSubagent).not.toHaveBeenCalled()

    releaseFirst()
    await queue.flush()
    expect(order).toEqual(['start-begin', 'start-end', 'pending'])
    expect(persistPendingSubagent).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      pendingEvent,
    )
  })

  it('keeps writing after a persist failure', async () => {
    persistSubagentHarnessEvent.mockRejectedValueOnce(new Error('disk full'))
    persistSubagentHarnessEvent.mockResolvedValueOnce(undefined)

    const queue = createSubagentPersistQueue('proj', 'chat-1')
    queue.handle(startEvent, () => undefined)
    queue.handle(nestedEvent, () => undefined)
    await queue.flush()

    expect(toast.error).toHaveBeenCalledWith('Failed to save subagent event', {
      description: 'disk full',
    })
    expect(persistSubagentHarnessEvent).toHaveBeenCalledTimes(2)
  })
})
