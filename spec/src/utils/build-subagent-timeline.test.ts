import { describe, expect, it } from 'vitest'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import buildSubagentTimeline from '@/utils/build-subagent-timeline'

const subagent = (
  partial: Partial<SubagentTimelineItem> = {},
): SubagentTimelineItem => ({
  type: 'subagent',
  subagentId: 'sub-1',
  name: 'explore',
  blocking: false,
  status: 'done',
  prompt: 'look around',
  summary: 'found things',
  tools: [
    {
      toolCallId: 't1',
      name: 'read_file',
      status: 'done',
      args: { path: 'a.ts' },
    },
  ],
  compactions: [],
  ...partial,
})

describe('buildSubagentTimeline', () => {
  it('places compaction items between the prompt and the agent turn', () => {
    const items = buildSubagentTimeline(
      subagent({
        compactions: [
          { summary: 'First compact', focus: 'auth', toolBoundary: 0 },
          { summary: 'Second compact', focus: null, toolBoundary: 0 },
        ],
      }),
    )

    expect(items.map((item) => item.type)).toEqual([
      'user',
      'compaction',
      'compaction',
      'agent-turn',
    ])
    expect(items[1]).toEqual({
      type: 'compaction',
      summary: 'First compact',
      focus: 'auth',
    })
    expect(items[2]).toEqual({
      type: 'compaction',
      summary: 'Second compact',
      focus: null,
    })
  })

  it('omits compaction items when the list is empty', () => {
    const items = buildSubagentTimeline(subagent())
    expect(items.map((item) => item.type)).toEqual(['user', 'agent-turn'])
  })

  it('keeps a single turn with all tools when there are no compactions', () => {
    const items = buildSubagentTimeline(subagent())
    const turnItem = items[1]
    expect(turnItem?.type).toBe('agent-turn')
    if (turnItem?.type !== 'agent-turn') {
      return
    }
    expect(turnItem.turn.id).toBe('sub-1-turn')
    expect(turnItem.turn.text).toBe('found things')
    expect(turnItem.turn.steps[0]?.tools.map((tool) => tool.toolCallId)).toEqual([
      't1',
    ])
  })

  it('splits tools around each compaction marker in order', () => {
    const items = buildSubagentTimeline(
      subagent({
        tools: [
          {
            toolCallId: 't1',
            name: 'read_file',
            status: 'done',
            args: { path: 'a.ts' },
          },
          {
            toolCallId: 't2',
            name: 'grep',
            status: 'done',
            args: { pattern: 'foo' },
          },
        ],
        compactions: [
          { summary: 'Kept the file reads', focus: 'auth', toolBoundary: 1 },
        ],
      }),
    )

    expect(items.map((item) => item.type)).toEqual([
      'user',
      'agent-turn',
      'compaction',
      'agent-turn',
    ])

    const preTurn = items[1]
    expect(preTurn?.type).toBe('agent-turn')
    if (preTurn?.type !== 'agent-turn') {
      return
    }
    expect(preTurn.turn.id).toBe('sub-1-turn-0')
    expect(preTurn.turn.text).toBe('')
    expect(preTurn.turn.steps[0]?.tools.map((tool) => tool.toolCallId)).toEqual([
      't1',
    ])

    expect(items[2]).toEqual({
      type: 'compaction',
      summary: 'Kept the file reads',
      focus: 'auth',
    })

    const postTurn = items[3]
    expect(postTurn?.type).toBe('agent-turn')
    if (postTurn?.type !== 'agent-turn') {
      return
    }
    expect(postTurn.turn.id).toBe('sub-1-turn-1')
    expect(postTurn.turn.text).toBe('found things')
    expect(postTurn.turn.steps[0]?.tools.map((tool) => tool.toolCallId)).toEqual([
      't2',
    ])
  })
})
