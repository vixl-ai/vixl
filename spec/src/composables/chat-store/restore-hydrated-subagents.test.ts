import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import restoreHydratedSubagents from '@/composables/chat-store/restore-hydrated-subagents'
import { SUBAGENT_INTERRUPTED_SUMMARY } from '@/composables/chat-store/timeline'
import {
  getSubagent,
  hasPendingBackgroundResume,
  listDeliverableBackgroundResults,
  resetSubagentRegistryForTests,
} from '@/services/harness/subagent/registry'

const subagent = (
  overrides: Partial<Extract<ChatTimelineItem, { type: 'subagent' }>> &
    Pick<Extract<ChatTimelineItem, { type: 'subagent' }>, 'status'>,
): ChatTimelineItem => ({
  type: 'subagent',
  subagentId: 'sub-1',
  toolCallId: 'tc-1',
  name: 'explorer',
  blocking: false,
  tools: [],
  steps: [],
  compacting: false,
  compactions: [],
  prompt: 'look around',
  model: 'local::qwen',
  capabilities: 'read-only',
  startedAt: '2020-01-01T00:00:00.000Z',
  ...overrides,
})

describe('restoreHydratedSubagents', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
  })

  it('maps timeline done to completed with the result summary', () => {
    restoreHydratedSubagents('chat-1', [
      subagent({ status: 'done', summary: 'found it' }),
    ])
    const record = getSubagent('sub-1')
    expect(record?.status).toBe('completed')
    expect(record?.result?.summary).toBe('found it')
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
  })

  it('maps incomplete error to interrupted without pending resume', () => {
    restoreHydratedSubagents('chat-1', [
      subagent({
        status: 'error',
        stop: { reason: 'incomplete' },
        summary: SUBAGENT_INTERRUPTED_SUMMARY,
      }),
    ])
    const record = getSubagent('sub-1')
    expect(record?.status).toBe('interrupted')
    expect(record?.result?.summary).toBe(SUBAGENT_INTERRUPTED_SUMMARY)
    expect(record?.messages).toEqual([{ role: 'user', content: 'look around' }])
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
  })

  it('maps other timeline errors to failed', () => {
    restoreHydratedSubagents('chat-1', [
      subagent({ status: 'error', summary: 'boom' }),
    ])
    expect(getSubagent('sub-1')?.status).toBe('failed')
    expect(getSubagent('sub-1')?.result?.summary).toBe('boom')
  })

  it('maps timeline stopped to aborted', () => {
    restoreHydratedSubagents('chat-1', [
      subagent({ status: 'stopped', summary: 'Stopped' }),
    ])
    expect(getSubagent('sub-1')?.status).toBe('aborted')
  })

  it('skips timeline running items', () => {
    restoreHydratedSubagents('chat-1', [subagent({ status: 'running' })])
    expect(getSubagent('sub-1')).toBeNull()
  })

  it('keeps snapshot messages on completed and failed records', () => {
    const messages = [
      { role: 'user' as const, content: 'look around' },
      { role: 'assistant' as const, content: 'found it' },
    ]
    restoreHydratedSubagents('chat-1', [
      subagent({ status: 'done', summary: 'found it', messages }),
    ])
    expect(getSubagent('sub-1')?.messages).toEqual(messages)
  })
})
