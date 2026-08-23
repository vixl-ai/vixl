import { describe, expect, it } from 'vitest'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { HarnessEvent } from '@/types/harness/harness-event'
import {
  appendSubagentToolEvent,
  completeSubagentTimelineItem,
  upsertSubagentStart,
} from '@/composables/chat-store/timeline'

const started = (): ChatTimelineItem[] =>
  upsertSubagentStart([], {
    subagentId: 'sub-1',
    name: 'explore',
    blocking: false,
    prompt: 'look around',
  })

describe('appendSubagentToolEvent compaction', () => {
  it('stores nested compaction on the subagent item without changing tools', () => {
    const withTool = appendSubagentToolEvent(started(), 'sub-1', {
      type: 'tool-start',
      toolCallId: 't1',
      name: 'read_file',
      args: { path: 'a.ts' },
    })
    const next = appendSubagentToolEvent(withTool, 'sub-1', {
      type: 'compaction',
      summary: 'Kept the file reads',
      focus: 'auth',
    })

    expect(next).toHaveLength(1)
    expect(next.some((item) => item.type === 'compaction')).toBe(false)

    const item = next[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.tools).toEqual([
      {
        toolCallId: 't1',
        name: 'read_file',
        status: 'running',
        args: { path: 'a.ts' },
      },
    ])
    expect(item.compactions).toEqual([
      { summary: 'Kept the file reads', focus: 'auth' },
    ])
  })

  it('does not append empty summary compaction', () => {
    const next = appendSubagentToolEvent(started(), 'sub-1', {
      type: 'compaction',
      summary: '',
      focus: null,
    })
    const item = next[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.compactions).toEqual([])
    expect(item.tools).toEqual([])
  })

  it('keeps compactions when completing the subagent', () => {
    const compacted = appendSubagentToolEvent(started(), 'sub-1', {
      type: 'compaction',
      summary: 'Prior work summarized',
      focus: null,
    })
    const done = completeSubagentTimelineItem(
      compacted,
      'sub-1',
      'found things',
      'done',
    )
    const item = done[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.status).toBe('done')
    expect(item.compactions).toEqual([
      { summary: 'Prior work summarized', focus: null },
    ])
  })

  it('still applies nested tool events after compaction', () => {
    const event: HarnessEvent = {
      type: 'tool-result',
      toolCallId: 't1',
      result: { content: 'ok' },
      isError: false,
    }
    const startedTools = appendSubagentToolEvent(started(), 'sub-1', {
      type: 'tool-start',
      toolCallId: 't1',
      name: 'read_file',
      args: { path: 'a.ts' },
    })
    const compacted = appendSubagentToolEvent(startedTools, 'sub-1', {
      type: 'compaction',
      summary: 'Trimmed earlier reads',
      focus: null,
    })
    const next = appendSubagentToolEvent(compacted, 'sub-1', event)
    const item = next[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.tools).toHaveLength(1)
    expect(item.tools[0]?.status).toBe('done')
    expect(item.compactions).toHaveLength(1)
  })
})
