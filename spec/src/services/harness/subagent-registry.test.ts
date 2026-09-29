import { beforeEach, describe, expect, it } from 'vitest'
import { computed } from 'vue'

describe('subagent-registry', () => {
  beforeEach(async () => {
    const { resetSubagentRegistryForTests } = await import(
      '@/services/harness/subagent/registry'
    )
    resetSubagentRegistryForTests()
  })

  it('registers a background subagent and tracks it by chat', async () => {
    const { register, getSubagent, hasSubagent } = await import(
      '@/services/harness/subagent/registry'
    )

    const controller = new AbortController()
    const record = register('chat-1', 'sub-1', controller, {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })

    expect(record.status).toBe('running')
    expect(hasSubagent('sub-1')).toBe(true)
    expect(getSubagent('sub-1')?.chatId).toBe('chat-1')
  })

  it('resolves waiters when a subagent completes', async () => {
    const { register, resolve, waitFor } = await import(
      '@/services/harness/subagent/registry'
    )

    const controller = new AbortController()
    register('chat-1', 'sub-1', controller, {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })

    const resultPromise = waitFor('chat-1', 'sub-1')
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'done',
    })

    await expect(resultPromise).resolves.toEqual({
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'done',
    })
  })

  it('aborts all subagents for a chat', async () => {
    const { register, abort, listSubagentsForChat } = await import(
      '@/services/harness/subagent/registry'
    )

    const first = new AbortController()
    const second = new AbortController()
    register('chat-1', 'sub-1', first, {
      toolCallId: 'tc-1',
      agentName: 'first',
    })
    register('chat-1', 'sub-2', second, {
      toolCallId: 'tc-2',
      agentName: 'second',
    })

    abort('chat-1')

    const records = listSubagentsForChat('chat-1')
    expect(records.every((record) => record.status === 'aborted')).toBe(true)
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
  })

  it('stores and retrieves turn response messages for resume', async () => {
    const {
      setTurnResponseMessages,
      getTurnResponseMessages,
      clearTurnResponseMessages,
    } = await import('@/services/harness/subagent/registry')

    const messages = [{ role: 'assistant' as const, content: 'hello' }]
    setTurnResponseMessages('chat-1', messages)
    expect(getTurnResponseMessages('chat-1')).toEqual(messages)
    clearTurnResponseMessages('chat-1')
    expect(getTurnResponseMessages('chat-1')).toBeNull()
  })

  it('marks pending background resume on register and clears on abort', async () => {
    const {
      register,
      abort,
      hasPendingBackgroundResume,
      clearPendingBackgroundResume,
    } = await import('@/services/harness/subagent/registry')

    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)

    abort('chat-1')
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)

    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'other',
    })
    clearPendingBackgroundResume('chat-1')
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
  })

  it('can register without marking pending resume', async () => {
    const { register, hasPendingBackgroundResume } = await import(
      '@/services/harness/subagent/registry'
    )

    register(
      'chat-1',
      'sub-1',
      new AbortController(),
      { toolCallId: 'tc-1', agentName: 'blocking' },
      { pendingResume: false },
    )
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
  })

  it('aborts only blocking subagents and keeps background running', async () => {
    const {
      abortBlocking,
      hasPendingBackgroundResume,
      listDeliverableBackgroundResults,
      listSubagentsForChat,
      register,
    } = await import('@/services/harness/subagent/registry')

    const blocking = new AbortController()
    const background = new AbortController()
    register(
      'chat-1',
      'block-1',
      blocking,
      { toolCallId: 'tc-block', agentName: 'blocking' },
      { pendingResume: false },
    )
    register('chat-1', 'bg-1', background, {
      toolCallId: 'tc-bg',
      agentName: 'background',
    })

    const aborted = abortBlocking('chat-1')

    expect(aborted).toEqual(['block-1'])
    expect(blocking.signal.aborted).toBe(true)
    expect(background.signal.aborted).toBe(false)
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    const records = listSubagentsForChat('chat-1')
    expect(records.find((record) => record.subagentId === 'block-1')?.status).toBe(
      'aborted',
    )
    expect(records.find((record) => record.subagentId === 'bg-1')?.status).toBe(
      'running',
    )
  })

  it('identifies running background subagents from pendingResume at register', async () => {
    const { isRunningBackgroundSubagent, register, resolve } = await import(
      '@/services/harness/subagent/registry'
    )

    register('chat-1', 'bg-1', new AbortController(), {
      toolCallId: 'tc-bg',
      agentName: 'background',
    })
    register(
      'chat-1',
      'block-1',
      new AbortController(),
      { toolCallId: 'tc-block', agentName: 'blocking' },
      { pendingResume: false },
    )

    expect(isRunningBackgroundSubagent('bg-1')).toBe(true)
    expect(isRunningBackgroundSubagent('block-1')).toBe(false)
    expect(isRunningBackgroundSubagent('missing')).toBe(false)

    resolve('bg-1', {
      subagentId: 'bg-1',
      name: 'background',
      summary: 'done',
    })
    expect(isRunningBackgroundSubagent('bg-1')).toBe(false)
  })

  it('does not bump the registry revision when abortBlocking is a no-op', async () => {
    const { abortBlocking, register, subagentRegistryRevision } = await import(
      '@/services/harness/subagent/registry'
    )

    register('chat-1', 'bg-1', new AbortController(), {
      toolCallId: 'tc-bg',
      agentName: 'background',
    })
    const afterRegister = subagentRegistryRevision.value

    expect(abortBlocking('chat-1')).toEqual([])
    expect(abortBlocking('chat-missing')).toEqual([])
    expect(subagentRegistryRevision.value).toBe(afterRegister)
  })

  it('lists only completed and failed results as deliverable', async () => {
    const {
      register,
      resolve,
      fail,
      abortOne,
      listDeliverableBackgroundResults,
      hasRunningSubagentsForChat,
    } = await import('@/services/harness/subagent/registry')

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'one',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'two',
    })
    register('chat-1', 'sub-3', new AbortController(), {
      toolCallId: 'tc-3',
      agentName: 'three',
    })
    register('chat-1', 'sub-4', new AbortController(), {
      toolCallId: 'tc-4',
      agentName: 'four',
    })

    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'one',
      summary: 'ok',
    })
    fail('sub-2', 'boom')
    abortOne('sub-3')

    expect(hasRunningSubagentsForChat('chat-1')).toBe(true)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-1',
        result: { subagentId: 'sub-1', name: 'one', summary: 'ok' },
      },
      {
        toolCallId: 'tc-2',
        result: { subagentId: 'sub-2', name: 'two', summary: 'boom' },
      },
    ])

    resolve('sub-4', {
      subagentId: 'sub-4',
      name: 'four',
      summary: 'last',
    })
    expect(hasRunningSubagentsForChat('chat-1')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-1')).toHaveLength(3)
  })

  it('omits delivered results while keeping running subagents', async () => {
    const {
      register,
      resolve,
      listDeliverableBackgroundResults,
      markBackgroundResultsDelivered,
      hasRunningSubagentsForChat,
    } = await import('@/services/harness/subagent/registry')

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'one',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'two',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'one',
      summary: 'ok',
    })

    markBackgroundResultsDelivered('chat-1', ['tc-1'])

    expect(hasRunningSubagentsForChat('chat-1')).toBe(true)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    resolve('sub-2', {
      subagentId: 'sub-2',
      name: 'two',
      summary: 'later',
    })
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-2',
        result: { subagentId: 'sub-2', name: 'two', summary: 'later' },
      },
    ])
  })

  it('keeps pending resume across a partial flush while a sibling is still running', async () => {
    const {
      register,
      resolve,
      listDeliverableBackgroundResults,
      markBackgroundResultsDelivered,
      hasPendingBackgroundResume,
      hasRunningSubagentsForChat,
    } = await import('@/services/harness/subagent/registry')

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'one',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'two',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'one',
      summary: 'ok',
    })

    const first = listDeliverableBackgroundResults('chat-1')
    expect(first).toHaveLength(1)
    markBackgroundResultsDelivered(
      'chat-1',
      first.map((item) => item.toolCallId),
    )

    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
    expect(hasRunningSubagentsForChat('chat-1')).toBe(true)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    resolve('sub-2', {
      subagentId: 'sub-2',
      name: 'two',
      summary: 'later',
    })
    expect(listDeliverableBackgroundResults('chat-1')).toHaveLength(1)
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
  })

  it('reopens a completed subagent back to running', async () => {
    const { register, resolve, reopen, getSubagent } = await import(
      '@/services/harness/subagent/registry'
    )

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'done',
    })

    const controller = new AbortController()
    expect(reopen('sub-1', controller)?.status).toBe('running')
    expect(getSubagent('sub-1')?.result).toBeUndefined()
    expect(reopen('sub-1', new AbortController())).toBeNull()
  })

  it('makes a previously delivered result deliverable again after reopen', async () => {
    const {
      register,
      resolve,
      reopen,
      listDeliverableBackgroundResults,
      markBackgroundResultsDelivered,
      hasPendingBackgroundResume,
    } = await import('@/services/harness/subagent/registry')

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'first',
    })
    markBackgroundResultsDelivered('chat-1', ['tc-1'])
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    expect(reopen('sub-1', new AbortController())?.status).toBe('running')
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)

    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'rewritten',
    })
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-1',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'rewritten',
        },
      },
    ])
  })

  it('reopens a delivered result while a sibling is still running', async () => {
    const {
      register,
      resolve,
      reopen,
      listDeliverableBackgroundResults,
      markBackgroundResultsDelivered,
      hasRunningSubagentsForChat,
    } = await import('@/services/harness/subagent/registry')

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'one',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'two',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'one',
      summary: 'first',
    })
    markBackgroundResultsDelivered('chat-1', ['tc-1'])
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(hasRunningSubagentsForChat('chat-1')).toBe(true)

    reopen('sub-1', new AbortController())
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'one',
      summary: 'steered',
    })

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-1',
        result: {
          subagentId: 'sub-1',
          name: 'one',
          summary: 'steered',
        },
      },
    ])
    expect(hasRunningSubagentsForChat('chat-1')).toBe(true)
  })

  it('clears the steer inbox when aborting a subagent or chat', async () => {
    const { register, abort, abortOne } = await import(
      '@/services/harness/subagent/registry'
    )
    const { pushSteer, drainSteers } = await import(
      '@/services/harness/subagent/inbox'
    )

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'one',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'two',
    })
    pushSteer('sub-1', 'one steer')
    pushSteer('sub-2', 'two steer')

    abortOne('sub-1')
    expect(drainSteers('sub-1')).toEqual([])

    abort('chat-1')
    expect(drainSteers('sub-2')).toEqual([])
  })

  it('bumps the registry revision on running and pending-resume transitions', async () => {
    const {
    abort,
    abortBlocking,
    abortOne,
    clearPendingBackgroundResume,
    fail,
    register,
    reopen,
    resetSubagentRegistryForTests,
    resolve,
    subagentRegistryRevision,
  } = await import('@/services/harness/subagent/registry')

    let last = subagentRegistryRevision.value
    const expectBump = (): void => {
      expect(subagentRegistryRevision.value).toBe(last + 1)
      last = subagentRegistryRevision.value
    }

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'one',
    })
    expectBump()

    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'one',
      summary: 'done',
    })
    expectBump()

    expect(reopen('sub-1', new AbortController())?.status).toBe('running')
    expectBump()

    abortOne('sub-1')
    expectBump()

    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'two',
    })
    expectBump()

    fail('sub-2', 'boom')
    expectBump()

    register('chat-1', 'sub-3', new AbortController(), {
      toolCallId: 'tc-3',
      agentName: 'three',
    })
    expectBump()

    abort('chat-1')
    expectBump()

    register('chat-1', 'sub-4', new AbortController(), {
      toolCallId: 'tc-4',
      agentName: 'four',
    })
    expectBump()

    register(
      'chat-1',
      'block-1',
      new AbortController(),
      { toolCallId: 'tc-block', agentName: 'blocking' },
      { pendingResume: false },
    )
    expectBump()

    expect(abortBlocking('chat-1')).toEqual(['block-1'])
    expectBump()

    clearPendingBackgroundResume('chat-1')
    expectBump()

    resetSubagentRegistryForTests()
    expectBump()
  })

  it('does not bump the registry revision on no-op transitions', async () => {
    const {
      abort,
      abortOne,
      clearPendingBackgroundResume,
      fail,
      register,
      reopen,
      resolve,
      subagentRegistryRevision,
    } = await import('@/services/harness/subagent/registry')

    const start = subagentRegistryRevision.value

    resolve('missing', {
      subagentId: 'missing',
      name: 'none',
      summary: 'noop',
    })
    fail('missing', 'noop')
    expect(reopen('missing', new AbortController())).toBeNull()
    abortOne('missing')
    abort('chat-missing')
    clearPendingBackgroundResume('chat-missing')
    expect(subagentRegistryRevision.value).toBe(start)

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'one',
    })
    const afterRegister = subagentRegistryRevision.value

    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'one',
      summary: 'done',
    })
    const afterResolve = subagentRegistryRevision.value
    expect(afterResolve).toBe(afterRegister + 1)

    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'one',
      summary: 'again',
    })
    fail('sub-1', 'already done')
    abortOne('sub-1')
    expect(subagentRegistryRevision.value).toBe(afterResolve)

    expect(reopen('sub-1', new AbortController())?.status).toBe('running')
    const afterReopen = subagentRegistryRevision.value
    expect(afterReopen).toBe(afterResolve + 1)
    expect(reopen('sub-1', new AbortController())).toBeNull()
    expect(subagentRegistryRevision.value).toBe(afterReopen)

    abortOne('sub-1')
    const afterAbortOne = subagentRegistryRevision.value
    abortOne('sub-1')
    expect(subagentRegistryRevision.value).toBe(afterAbortOne)

    abort('chat-1')
    const afterAbort = subagentRegistryRevision.value
    abort('chat-1')
    clearPendingBackgroundResume('chat-1')
    expect(subagentRegistryRevision.value).toBe(afterAbort)
  })

  it('lets pending-resume consumers refresh from the registry revision', async () => {
    const {
      abort,
      clearPendingBackgroundResume,
      hasPendingBackgroundResume,
      register,
      subagentRegistryRevision,
    } = await import('@/services/harness/subagent/registry')

    const waiting = computed(
      () =>
        subagentRegistryRevision.value >= 0 &&
        hasPendingBackgroundResume('chat-1'),
    )

    expect(waiting.value).toBe(false)

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    expect(waiting.value).toBe(true)

    clearPendingBackgroundResume('chat-1')
    expect(waiting.value).toBe(false)

    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'other',
    })
    expect(waiting.value).toBe(true)

    abort('chat-1')
    expect(waiting.value).toBe(false)
  })

  it('clears leftover pending resume on abort when the chat has no subagent ids', async () => {
    const {
      abort,
      hasPendingBackgroundResume,
      register,
      reopen,
      resolve,
      subagentRegistryRevision,
    } = await import('@/services/harness/subagent/registry')

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'done',
    })
    abort('chat-1')
    expect(reopen('sub-1', new AbortController())?.status).toBe('running')
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)

    const waiting = computed(
      () =>
        subagentRegistryRevision.value >= 0 &&
        hasPendingBackgroundResume('chat-1'),
    )
    expect(waiting.value).toBe(true)

    const beforeAbort = subagentRegistryRevision.value
    abort('chat-1')
    expect(subagentRegistryRevision.value).toBe(beforeAbort + 1)
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
    expect(waiting.value).toBe(false)
  })
})
