import { beforeEach, describe, expect, it, vi } from 'vitest'

const persistToolRun = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistToolRun: (...args: unknown[]) => persistToolRun(...args),
}))

import { finalizeBackgroundSpawnResults } from '@/services/harness/orchestrator/finalize-background-spawns'
import {
  fail,
  isBackgroundResultFinalized,
  listDeliverableBackgroundResults,
  register,
  reopen,
  resetSubagentRegistryForTests,
  resolve,
} from '@/services/harness/subagent/registry'

describe('finalizeBackgroundSpawnResults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    persistToolRun.mockResolvedValue(undefined)
  })

  it('skips a second finalize for the same toolCallId while leaving the result deliverable', async () => {
    register('chat-1', 'sub-fail', new AbortController(), {
      toolCallId: 'tc-fail',
      agentName: 'explorer',
    })
    fail('sub-fail', 'explorer timed out')
    const completed = listDeliverableBackgroundResults('chat-1')
    const onEvent = vi.fn<(...args: unknown[]) => void>()

    const first = await finalizeBackgroundSpawnResults(
      'proj',
      'chat-1',
      completed,
      onEvent,
      null,
    )
    const second = await finalizeBackgroundSpawnResults(
      'proj',
      'chat-1',
      completed,
      onEvent,
      null,
    )

    expect(first).toEqual(completed)
    expect(second).toEqual(completed)
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(persistToolRun).toHaveBeenCalledTimes(1)
    expect(isBackgroundResultFinalized('chat-1', 'tc-fail')).toBe(true)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual(completed)
  })

  it('does not mark finalized when persistToolRun fails', async () => {
    register('chat-1', 'sub-fail', new AbortController(), {
      toolCallId: 'tc-fail',
      agentName: 'explorer',
    })
    fail('sub-fail', 'explorer timed out')
    const completed = listDeliverableBackgroundResults('chat-1')
    const onEvent = vi.fn<(...args: unknown[]) => void>()
    persistToolRun.mockRejectedValueOnce(new Error('disk full'))

    await expect(
      finalizeBackgroundSpawnResults('proj', 'chat-1', completed, onEvent, null),
    ).rejects.toThrow('disk full')
    expect(isBackgroundResultFinalized('chat-1', 'tc-fail')).toBe(false)

    persistToolRun.mockResolvedValue(undefined)
    await finalizeBackgroundSpawnResults(
      'proj',
      'chat-1',
      completed,
      onEvent,
      null,
    )

    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(persistToolRun).toHaveBeenCalledTimes(2)
    expect(isBackgroundResultFinalized('chat-1', 'tc-fail')).toBe(true)
  })

  it('skips a steered snapshot so the newer result can still be finalized', async () => {
    register('chat-1', 'sub-fail', new AbortController(), {
      toolCallId: 'tc-fail',
      agentName: 'explorer',
    })
    fail('sub-fail', 'explorer timed out')
    const snapshot = listDeliverableBackgroundResults('chat-1')
    const stale = snapshot[0]
    if (!stale) {
      throw new Error('expected a deliverable failed result')
    }

    expect(reopen('sub-fail', new AbortController())?.status).toBe('running')
    resolve('sub-fail', {
      subagentId: 'sub-fail',
      name: 'explorer',
      summary: 'steered rewrite',
    })
    const steered = listDeliverableBackgroundResults('chat-1')
    const steeredItem = steered[0]
    if (!steeredItem) {
      throw new Error('expected a deliverable steered result')
    }

    const onEvent = vi.fn<(...args: unknown[]) => void>()
    await finalizeBackgroundSpawnResults(
      'proj',
      'chat-1',
      snapshot,
      onEvent,
      null,
    )

    expect(onEvent).not.toHaveBeenCalled()
    expect(persistToolRun).not.toHaveBeenCalled()
    expect(isBackgroundResultFinalized('chat-1', 'tc-fail')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual(steered)

    await finalizeBackgroundSpawnResults(
      'proj',
      'chat-1',
      steered,
      onEvent,
      null,
    )

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({
      type: 'tool-result',
      toolCallId: 'tc-fail',
      result: steeredItem.result,
      isError: false,
    })
    expect(persistToolRun).toHaveBeenCalledTimes(1)
    expect(persistToolRun).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      'tc-fail',
      'spawn_subagent',
      'done',
      '',
      {
        agentName: 'explorer',
        blocking: false,
      },
      steeredItem.result,
    )
    expect(isBackgroundResultFinalized('chat-1', 'tc-fail')).toBe(true)
  })

  it('does not mark finalized when a steer lands during persistToolRun', async () => {
    register('chat-1', 'sub-fail', new AbortController(), {
      toolCallId: 'tc-fail',
      agentName: 'explorer',
    })
    fail('sub-fail', 'explorer timed out')
    const snapshot = listDeliverableBackgroundResults('chat-1')
    const stale = snapshot[0]
    if (!stale) {
      throw new Error('expected a deliverable failed result')
    }

    persistToolRun.mockImplementationOnce(async () => {
      expect(reopen('sub-fail', new AbortController())?.status).toBe('running')
      resolve('sub-fail', {
        subagentId: 'sub-fail',
        name: 'explorer',
        summary: 'steered rewrite',
      })
    })

    const onEvent = vi.fn<(...args: unknown[]) => void>()
    const first = await finalizeBackgroundSpawnResults(
      'proj',
      'chat-1',
      snapshot,
      onEvent,
      null,
    )

    expect(first).toEqual([])
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(persistToolRun).toHaveBeenCalledTimes(1)
    expect(isBackgroundResultFinalized('chat-1', 'tc-fail')).toBe(false)

    const steered = listDeliverableBackgroundResults('chat-1')
    const steeredItem = steered[0]
    if (!steeredItem) {
      throw new Error('expected a deliverable steered result')
    }
    expect(steeredItem.result).not.toBe(stale.result)

    persistToolRun.mockResolvedValue(undefined)
    const second = await finalizeBackgroundSpawnResults(
      'proj',
      'chat-1',
      steered,
      onEvent,
      null,
    )

    expect(second).toEqual(steered)
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenLastCalledWith({
      type: 'tool-result',
      toolCallId: 'tc-fail',
      result: steeredItem.result,
      isError: false,
    })
    expect(persistToolRun).toHaveBeenCalledTimes(2)
    expect(isBackgroundResultFinalized('chat-1', 'tc-fail')).toBe(true)
  })
})
