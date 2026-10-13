import { beforeEach, describe, expect, it } from 'vitest'
import collectPrefinishedBackgroundResults, {
  commitPrefinishedBackgroundResults,
} from '@/composables/agent-harness/collect-prefinished-background-results'
import {
  fail,
  hasPendingBackgroundResume,
  listDeliverableBackgroundResults,
  register,
  reopen,
  resetSubagentRegistryForTests,
  resolve,
} from '@/services/harness/subagent/registry'

describe('collectPrefinishedBackgroundResults', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
  })

  it('snapshots background results without marking blocking inline results delivered', () => {
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
    fail('bg-1', 'explorer timed out')

    const snapshot = collectPrefinishedBackgroundResults('chat-1', false, false)

    expect(snapshot).toEqual([
      {
        toolCallId: 'tc-bg',
        result: {
          subagentId: 'bg-1',
          name: 'explorer',
          summary: 'explorer timed out',
        },
      },
    ])
    expect(listDeliverableBackgroundResults('chat-1')).toEqual(snapshot)

    commitPrefinishedBackgroundResults('chat-1', snapshot)

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
  })

  it('does not swallow a result that was steered and re-finished during the user turn', () => {
    register('chat-1', 'bg-1', new AbortController(), {
      toolCallId: 'tc-bg',
      agentName: 'explorer',
    })
    fail('bg-1', 'explorer timed out')

    const snapshot = collectPrefinishedBackgroundResults('chat-1', false, false)
    expect(snapshot).toEqual([
      {
        toolCallId: 'tc-bg',
        result: {
          subagentId: 'bg-1',
          name: 'explorer',
          summary: 'explorer timed out',
        },
      },
    ])

    expect(reopen('bg-1', new AbortController())?.status).toBe('running')
    resolve('bg-1', {
      subagentId: 'bg-1',
      name: 'explorer',
      summary: 'steered rewrite',
    })

    commitPrefinishedBackgroundResults('chat-1', snapshot)

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-bg',
        result: {
          subagentId: 'bg-1',
          name: 'explorer',
          summary: 'steered rewrite',
        },
      },
    ])
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
  })

  it('marks only unsteered snapshot results delivered when a sibling is reopened', () => {
    register('chat-1', 'bg-keep', new AbortController(), {
      toolCallId: 'tc-keep',
      agentName: 'keeper',
    })
    register('chat-1', 'bg-steer', new AbortController(), {
      toolCallId: 'tc-steer',
      agentName: 'explorer',
    })
    fail('bg-keep', 'keeper timed out')
    fail('bg-steer', 'explorer timed out')

    const snapshot = collectPrefinishedBackgroundResults('chat-1', false, false)
    expect(snapshot?.map((item) => item.toolCallId)).toEqual([
      'tc-keep',
      'tc-steer',
    ])

    expect(reopen('bg-steer', new AbortController())?.status).toBe('running')
    resolve('bg-steer', {
      subagentId: 'bg-steer',
      name: 'explorer',
      summary: 'steered rewrite',
    })

    commitPrefinishedBackgroundResults('chat-1', snapshot)

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-steer',
        result: {
          subagentId: 'bg-steer',
          name: 'explorer',
          summary: 'steered rewrite',
        },
      },
    ])
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
  })
})
