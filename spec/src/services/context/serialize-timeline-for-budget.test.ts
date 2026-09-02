import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import serializeTimelineForBudget from '@/services/context/serialize-timeline-for-budget'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'

const userMessage = (id: string, text: string, createdAt?: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
  metadata: createdAt ? { createdAt } : undefined,
})

describe('serializeTimelineForBudget', () => {
  it('includes tool args and results from agent turns', () => {
    const toolPayload = 'x'.repeat(4000)
    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: userMessage('u1', 'read the big file'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'a1',
          text: 'done',
          steps: [
            {
              id: 's1',
              text: 'reading',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'read_file',
                  status: 'done',
                  args: { path: '/tmp/big.txt' },
                  result: { content: toolPayload },
                },
              ],
            },
          ],
        },
      },
    ]

    const serialized = serializeTimelineForBudget({ timeline })
    expect(serialized).toContain('read the big file')
    expect(serialized).toContain('read_file')
    expect(serialized).toContain(toolPayload)
    expect(serialized).toContain('done')
  })

  it('applies activeContext cutoff and checkpoint text', () => {
    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: userMessage('old', 'old prompt ' + 'x'.repeat(200), '2026-01-01T00:00:00.000Z'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'old-a',
          text: 'old reply',
          steps: [
            {
              id: 's-old',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't-old',
                  name: 'read_file',
                  status: 'done',
                  args: { path: '/old' },
                  result: { content: 'old-tool-result' },
                },
              ],
            },
          ],
        },
      },
      {
        type: 'user',
        message: userMessage('new', 'new prompt', '2026-01-03T00:00:00.000Z'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'new-a',
          text: 'new reply',
          steps: [],
        },
      },
    ]

    const serialized = serializeTimelineForBudget({
      timeline,
      checkpointText: 'Prior checkpoint: summary',
      includeFromCreatedAt: '2026-01-03T00:00:00.000Z',
    })

    expect(serialized).toContain('Prior checkpoint: summary')
    expect(serialized).toContain('new prompt')
    expect(serialized).toContain('new reply')
    expect(serialized).not.toContain('old-tool-result')
    expect(serialized).not.toContain('old prompt')
  })

  it('does not include nested subagent tool streams', () => {
    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: userMessage('u1', 'explore'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'a1',
          text: 'spawning',
          steps: [
            {
              id: 's1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 'spawn-1',
                  name: 'spawn_subagent',
                  status: 'done',
                  args: { prompt: 'look around' },
                  result: { summary: 'found things' },
                },
              ],
            },
          ],
        },
      },
      {
        type: 'subagent',
        subagentId: 'sub-1',
        name: 'explore',
        blocking: true,
        status: 'done',
        summary: 'found things',
        compactions: [],
        tools: [
          {
            toolCallId: 'nested-1',
            name: 'read_file',
            status: 'done',
            args: { path: '/nested' },
            result: { content: 'NESTED_ONLY_CONTENT' },
          },
        ],
      },
    ]

    const serialized = serializeTimelineForBudget({ timeline })
    expect(serialized).toContain('spawn_subagent')
    expect(serialized).toContain('found things')
    expect(serialized).not.toContain('NESTED_ONLY_CONTENT')
  })

  it('cuts at the compaction marker and drops pre-compaction tool I/O', () => {
    const precompactPayload = 'PRECOMPACT_' + 'x'.repeat(4000)
    const u1CreatedAt = '2026-01-01T00:00:00.000Z'
    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: userMessage('u1', 'before prompt with unique text', u1CreatedAt),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'a1',
          text: 'precompact reply',
          steps: [
            {
              id: 's1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'read_file',
                  status: 'done',
                  args: { path: '/tmp/big.txt' },
                  result: { content: precompactPayload },
                },
              ],
            },
          ],
        },
      },
      {
        type: 'compaction',
        summary: 'SUMMARY_TEXT',
        focus: 'parent',
      },
      {
        type: 'user',
        message: userMessage('u2', 'after prompt', '2026-01-02T00:00:00.000Z'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'a2',
          text: 'after reply',
          steps: [
            {
              id: 's2',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't2',
                  name: 'read_file',
                  status: 'done',
                  args: { path: '/tmp/after.txt' },
                  result: { content: 'POSTCOMPACT_CONTENT' },
                },
              ],
            },
          ],
        },
      },
    ]

    const serialized = serializeTimelineForBudget({
      timeline,
      checkpointText: 'Prior checkpoint: SUMMARY_TEXT',
      includeFromCreatedAt: u1CreatedAt,
    })

    expect(serialized).toContain('Prior checkpoint: SUMMARY_TEXT')
    expect(serialized).toContain('after prompt')
    expect(serialized).toContain('after reply')
    expect(serialized).toContain('POSTCOMPACT_CONTENT')
    expect(serialized).not.toContain('PRECOMPACT_')
    expect(serialized).not.toContain('before prompt with unique text')
  })

  it('falls back to the marker summary when checkpointText is empty', () => {
    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: userMessage('u1', 'before prompt'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'a1',
          text: 'precompact reply',
          steps: [
            {
              id: 's1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'read_file',
                  status: 'done',
                  args: { path: '/tmp/big.txt' },
                  result: { content: 'PRECOMPACT_' + 'x'.repeat(4000) },
                },
              ],
            },
          ],
        },
      },
      {
        type: 'compaction',
        summary: 'SUMMARY_TEXT',
        focus: 'parent',
      },
      {
        type: 'user',
        message: userMessage('u2', 'after prompt'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'a2',
          text: 'after reply',
          steps: [
            {
              id: 's2',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't2',
                  name: 'read_file',
                  status: 'done',
                  args: { path: '/tmp/after.txt' },
                  result: { content: 'POSTCOMPACT_CONTENT' },
                },
              ],
            },
          ],
        },
      },
    ]

    const serialized = serializeTimelineForBudget({ timeline })
    expect(serialized).toContain('SUMMARY_TEXT')
    expect(serialized).toContain('POSTCOMPACT_CONTENT')
    expect(serialized).not.toContain('PRECOMPACT_')
  })
})
