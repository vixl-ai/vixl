import { beforeEach, describe, expect, it } from 'vitest'
import flushPendingBackgroundResume from '@/services/harness/subagent/flush-pending-resume'
import {
  fail,
  getTurnResponseMessages,
  hasPendingBackgroundResume,
  hasRunningSubagentsForChat,
  listDeliverableBackgroundResults,
  markBackgroundResultsDelivered,
  register,
  resetSubagentRegistryForTests,
  resolve,
  setTurnResponseMessages,
} from '@/services/harness/subagent/registry'

describe('flushPendingBackgroundResume', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
  })

  it('drops the captured turn but keeps the wake while a background subagent is still running', () => {
    const controller = new AbortController()
    register('chat-1', 'sub-1', controller, {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    setTurnResponseMessages('chat-1', [{ role: 'assistant', content: 'wave-1' }])
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)

    flushPendingBackgroundResume('chat-1')

    expect(getTurnResponseMessages('chat-1')).toBeNull()
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
    expect(hasRunningSubagentsForChat('chat-1')).toBe(true)
    expect(controller.signal.aborted).toBe(false)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    fail('sub-1', 'explorer timed out')
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-1',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'explorer timed out',
        },
      },
    ])
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
  })

  it('marks already-finished results delivered without pre-delivering a still-running sibling', () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', [{ role: 'assistant', content: 'wave-1' }])

    flushPendingBackgroundResume('chat-1')

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(getTurnResponseMessages('chat-1')).toBeNull()
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
    expect(hasRunningSubagentsForChat('chat-1')).toBe(true)

    fail('sub-2', 'writer failed')
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-2',
        result: {
          subagentId: 'sub-2',
          name: 'writer',
          summary: 'writer failed',
        },
      },
    ])
  })

  it('clears the pending wake when nothing is running and no undelivered results remain', () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    markBackgroundResultsDelivered('chat-1', ['tc-1'])
    setTurnResponseMessages('chat-1', [{ role: 'assistant', content: 'wave-1' }])
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
    expect(hasRunningSubagentsForChat('chat-1')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    flushPendingBackgroundResume('chat-1')

    expect(getTurnResponseMessages('chat-1')).toBeNull()
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
  })

  it('can drop the captured turn without marking finished results delivered', () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', [{ role: 'assistant', content: 'wave-1' }])

    flushPendingBackgroundResume('chat-1', { markDelivered: false })

    expect(getTurnResponseMessages('chat-1')).toBeNull()
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-1',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'mapped the repo',
        },
      },
    ])
  })

  it('does not treat a finished blocking sibling as a deliverable wake result', () => {
    register(
      'chat-1',
      'block-1',
      new AbortController(),
      { toolCallId: 'tc-block', agentName: 'blocking' },
      { pendingResume: false },
    )
    register('chat-1', 'bg-1', new AbortController(), {
      toolCallId: 'tc-bg',
      agentName: 'explorer',
    })
    resolve('block-1', {
      subagentId: 'block-1',
      name: 'blocking',
      summary: 'inline done',
    })
    resolve('bg-1', {
      subagentId: 'bg-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', [{ role: 'assistant', content: 'wave-1' }])

    flushPendingBackgroundResume('chat-1', { markDelivered: false })

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-bg',
        result: {
          subagentId: 'bg-1',
          name: 'explorer',
          summary: 'mapped the repo',
        },
      },
    ])
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)

    flushPendingBackgroundResume('chat-1')

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
  })

  it('clears the pending wake after marking the last finished results delivered', () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', [{ role: 'assistant', content: 'wave-1' }])

    flushPendingBackgroundResume('chat-1')

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(getTurnResponseMessages('chat-1')).toBeNull()
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
  })
})
