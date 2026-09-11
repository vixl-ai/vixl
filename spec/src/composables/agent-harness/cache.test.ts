import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dropAgentHarness,
  getCachedAgentHarness,
  rekeyAgentHarness,
  resetAgentHarnessCacheForTests,
  setCachedAgentHarness,
} from '@/composables/agent-harness/cache'

describe('rekeyAgentHarness', () => {
  beforeEach(() => {
    resetAgentHarnessCacheForTests()
  })

  it('moves the same harness instance and drops the old key', () => {
    const instance = {
      markDisposed: vi.fn<() => void>(),
      dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    }
    setCachedAgentHarness('_home_', 'chat-1', instance)

    rekeyAgentHarness('_home_', 'chat-1', 'dest')

    expect(getCachedAgentHarness('_home_', 'chat-1')).toBeUndefined()
    expect(getCachedAgentHarness('dest', 'chat-1')).toBe(instance)
  })
})

describe('dropAgentHarness', () => {
  beforeEach(() => {
    resetAgentHarnessCacheForTests()
  })

  it('marks disposed synchronously before async dispose finishes', async () => {
    let release: (() => void) | undefined
    const disposePromise = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const markDisposed = vi.fn<() => void>()
    const dispose = vi.fn<() => Promise<void>>().mockReturnValue(disposePromise)
    setCachedAgentHarness('proj', 'chat-1', { markDisposed, dispose })

    dropAgentHarness('proj', 'chat-1')

    expect(getCachedAgentHarness('proj', 'chat-1')).toBeUndefined()
    expect(markDisposed).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(markDisposed.mock.invocationCallOrder[0]).toBeLessThan(
      dispose.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )

    release?.()
    await disposePromise
  })
})
