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
          { summary: 'First compact', focus: 'auth' },
          { summary: 'Second compact', focus: null },
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
})
