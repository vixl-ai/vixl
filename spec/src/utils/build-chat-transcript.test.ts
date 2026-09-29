import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ToolRun } from '@/types/harness/tool-run'
import buildChatTranscript from '@/utils/build-chat-transcript'

const userMessage = (text: string): UIMessage => ({
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text }],
})

const toolRun = (partial: Partial<ToolRun> & Pick<ToolRun, 'name'>): ToolRun => ({
  toolCallId: partial.toolCallId ?? `${partial.name}-1`,
  status: partial.status ?? 'done',
  ...partial,
})

const agentTurn = (partial: Partial<AgentTurn> = {}): ChatTimelineItem => ({
  type: 'agent-turn',
  turn: {
    id: 'turn-1',
    text: '',
    steps: [],
    ...partial,
  },
})

const subagentItem = (
  partial: Partial<SubagentTimelineItem> = {},
): SubagentTimelineItem => ({
  type: 'subagent',
  subagentId: 'sub-1',
  name: 'explore',
  blocking: false,
  status: 'done',
  prompt: 'look around',
  summary: 'found things',
  tools: [toolRun({ name: 'read_file', toolCallId: 't1', args: { path: 't1.ts' } })],
  compactions: [],
  ...partial,
})

describe('buildChatTranscript', () => {
  it('returns empty conversation for an empty timeline', () => {
    expect(buildChatTranscript([])).toBe('(empty conversation)')
  })

  it('keeps user message output as USER followed by the body', () => {
    const transcript = buildChatTranscript([
      { type: 'user', message: userMessage('hello world') },
    ])
    expect(transcript).toBe('USER:\nhello world')
  })

  it('emits a compact tool line for a tool-only assistant turn', () => {
    const transcript = buildChatTranscript([
      agentTurn({
        steps: [
          {
            id: 'step-1',
            text: '',
            reasoning: '',
            tools: [
              toolRun({
                name: 'read_file',
                args: { path: 'src/foo.ts' },
              }),
            ],
          },
        ],
      }),
    ])
    expect(transcript).toBe('ASSISTANT:\nTOOL read_file [done] {"path":"src/foo.ts"}')
  })

  it('emits assistant text then tool lines for a mixed turn', () => {
    const transcript = buildChatTranscript([
      agentTurn({
        steps: [
          {
            id: 'step-1',
            text: 'I will read the file.',
            reasoning: 'Need the contents first.',
            tools: [
              toolRun({
                name: 'read_file',
                args: { path: 'src/foo.ts' },
              }),
            ],
          },
        ],
      }),
    ])
    expect(transcript).toBe(
      [
        'ASSISTANT:',
        'Need the contents first.',
        'I will read the file.',
        'TOOL read_file [done] {"path":"src/foo.ts"}',
      ].join('\n'),
    )
  })

  it('places leftover turn text after steps and tools', () => {
    const transcript = buildChatTranscript([
      agentTurn({
        text: 'Here is what I found.',
        steps: [
          {
            id: 'step-1',
            text: 'I will read the file.',
            reasoning: '',
            tools: [
              toolRun({
                name: 'read_file',
                args: { path: 'src/foo.ts' },
              }),
            ],
          },
        ],
      }),
    ])
    expect(transcript).toBe(
      [
        'ASSISTANT:',
        'I will read the file.',
        'TOOL read_file [done] {"path":"src/foo.ts"}',
        'Here is what I found.',
      ].join('\n'),
    )
  })

  it('keeps multi-step text and tools in chronological step order', () => {
    const transcript = buildChatTranscript([
      agentTurn({
        text: 'Here is what I found.',
        steps: [
          {
            id: 'step-1',
            text: 'I will search.',
            reasoning: 'Search first.',
            tools: [
              toolRun({
                name: 'grep',
                args: { pattern: 'TODO' },
              }),
            ],
          },
          {
            id: 'step-2',
            text: 'Opening the file.',
            reasoning: 'Now read it.',
            tools: [
              toolRun({
                name: 'read_file',
                args: { path: 'src/foo.ts' },
              }),
            ],
          },
        ],
      }),
    ])
    expect(transcript).toBe(
      [
        'ASSISTANT:',
        'Search first.',
        'I will search.',
        'TOOL grep [done] {"pattern":"TODO"}',
        'Now read it.',
        'Opening the file.',
        'TOOL read_file [done] {"path":"src/foo.ts"}',
        'Here is what I found.',
      ].join('\n'),
    )
  })

  it('appends the turn error line after step content', () => {
    const transcript = buildChatTranscript([
      agentTurn({
        error: { kind: 'timeout', message: 'The model stalled' },
        steps: [
          {
            id: 'step-1',
            text: 'Checking the file.',
            reasoning: '',
            tools: [
              toolRun({
                name: 'read_file',
                args: { path: 'src/foo.ts' },
              }),
            ],
          },
        ],
      }),
    ])
    expect(transcript).toBe(
      [
        'ASSISTANT:',
        'Checking the file.',
        'TOOL read_file [done] {"path":"src/foo.ts"}',
        'error (timeout): The model stalled',
      ].join('\n'),
    )
  })

  it('keeps (empty) only when a turn has no text, reasoning, or tools', () => {
    const transcript = buildChatTranscript([
      agentTurn({
        steps: [{ id: 'step-1', text: '', reasoning: '', tools: [] }],
      }),
    ])
    expect(transcript).toBe('ASSISTANT:\n(empty)')
  })

  it('includes the error message for an error-status tool run', () => {
    const transcript = buildChatTranscript([
      agentTurn({
        steps: [
          {
            id: 'step-1',
            text: '',
            reasoning: '',
            tools: [
              toolRun({
                name: 'grep',
                status: 'error',
                args: { pattern: 'TODO' },
                result: { error: 'File not found' },
              }),
            ],
          },
        ],
      }),
    ])
    expect(transcript).toBe(
      'ASSISTANT:\nTOOL grep [error] {"pattern":"TODO"} File not found',
    )
  })

  it('joins user and assistant blocks with a blank line', () => {
    const transcript = buildChatTranscript([
      { type: 'user', message: userMessage('look at foo') },
      agentTurn({
        steps: [
          {
            id: 'step-1',
            text: '',
            reasoning: '',
            tools: [
              toolRun({
                name: 'read_file',
                args: { path: 'src/foo.ts' },
              }),
            ],
          },
        ],
      }),
    ])
    expect(transcript).toBe(
      [
        'USER:',
        'look at foo',
        '',
        'ASSISTANT:',
        'TOOL read_file [done] {"path":"src/foo.ts"}',
      ].join('\n'),
    )
  })

  it('keeps the subagent header, prompt, tools, and trailing summary', () => {
    const transcript = buildChatTranscript([subagentItem()])
    expect(transcript).toBe(
      [
        'SUBAGENT explore [done]',
        'look around',
        'TOOL read_file [done] {"path":"t1.ts"}',
        'summary: found things',
      ].join('\n'),
    )
  })

  it('interleaves subagent tools with a steer and a compaction at their boundaries', () => {
    const transcript = buildChatTranscript([
      subagentItem({
        tools: [
          toolRun({ name: 'read_file', toolCallId: 't1', args: { path: 't1.ts' } }),
          toolRun({ name: 'grep', toolCallId: 't2', args: { path: 't2.ts' } }),
          toolRun({ name: 'read_file', toolCallId: 't3', args: { path: 't3.ts' } }),
        ],
        compactions: [
          { summary: 'Kept the file reads', focus: 'auth', toolBoundary: 1 },
        ],
        steers: [{ message: 'keep going', toolBoundary: 2 }],
      }),
    ])
    expect(transcript).toBe(
      [
        'SUBAGENT explore [done]',
        'look around',
        'TOOL read_file [done] {"path":"t1.ts"}',
        'compaction: Kept the file reads',
        'focus: auth',
        'TOOL grep [done] {"path":"t2.ts"}',
        'steer: keep going',
        'TOOL read_file [done] {"path":"t3.ts"}',
        'summary: found things',
      ].join('\n'),
    )
  })

  it('emits subagent reasoning and text in history order around tools', () => {
    const transcript = buildChatTranscript([
      subagentItem({
        messages: [
          { role: 'user', content: 'look around' },
          {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: 'Need the file first.' },
              {
                type: 'tool-call',
                toolCallId: 't1',
                toolName: 'read_file',
                input: { path: 't1.ts' },
              },
              { type: 'text', text: 'It exports foo.' },
            ],
          },
        ],
      }),
    ])
    expect(transcript).toBe(
      [
        'SUBAGENT explore [done]',
        'look around',
        'Need the file first.',
        'TOOL read_file [done] {"path":"t1.ts"}',
        'It exports foo.',
        'summary: found things',
      ].join('\n'),
    )
  })

  it('keeps subagent history text around compaction and steer boundaries', () => {
    const transcript = buildChatTranscript([
      subagentItem({
        tools: [
          toolRun({ name: 'read_file', toolCallId: 't1', args: { path: 't1.ts' } }),
          toolRun({ name: 'grep', toolCallId: 't2', args: { path: 't2.ts' } }),
        ],
        compactions: [
          { summary: 'Kept the file reads', focus: 'auth', toolBoundary: 1 },
        ],
        steers: [{ message: 'keep going', toolBoundary: 2 }],
        messages: [
          { role: 'user', content: 'look around' },
          {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: 'Start with a read.' },
              {
                type: 'tool-call',
                toolCallId: 't1',
                toolName: 'read_file',
                input: { path: 't1.ts' },
              },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Now search.' },
              {
                type: 'tool-call',
                toolCallId: 't2',
                toolName: 'grep',
                input: { path: 't2.ts' },
              },
            ],
          },
        ],
      }),
    ])
    expect(transcript).toBe(
      [
        'SUBAGENT explore [done]',
        'look around',
        'Start with a read.',
        'TOOL read_file [done] {"path":"t1.ts"}',
        'compaction: Kept the file reads',
        'focus: auth',
        'Now search.',
        'TOOL grep [done] {"path":"t2.ts"}',
        'steer: keep going',
        'summary: found things',
      ].join('\n'),
    )
  })
})
