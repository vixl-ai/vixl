import { describe, expect, it } from 'vitest'
import { convertToModelMessages } from 'ai'
import {
  buildAssistantMessage,
  extractReasoningDuration,
  parsePart,
  rebuildMessagesFromTimeline,
  updateAssistantMessage,
} from '@/composables/chat-store/message-parsing'
import { createSession } from '@/composables/chat-store/helpers'
import type { AgentTurn } from '@/types/chat/agent-turn'

const toolTurn = (text = ''): AgentTurn => ({
  id: 'turn-1',
  text,
  createdAt: '2020-01-01T00:00:00.000Z',
  steps: [
    {
      id: 'step-1',
      text: '',
      reasoning: '',
      tools: [
        {
          toolCallId: 'tc-1',
          name: 'read_file',
          status: 'done',
          args: { path: 'a.ts' },
          result: { content: 'ok' },
        },
      ],
    },
  ],
})

const multiStepTurn = (): AgentTurn => ({
  id: 'turn-multi',
  text: 'Here is what I found.',
  createdAt: '2020-01-01T00:00:00.000Z',
  steps: [
    {
      id: 'step-1',
      text: 'I will search.',
      reasoning: 'Search first.',
      tools: [
        {
          toolCallId: 'tc-1',
          name: 'grep',
          status: 'done',
          args: { pattern: 'TODO' },
          result: { matches: 1 },
        },
      ],
    },
    {
      id: 'step-2',
      text: 'Opening the file.',
      reasoning: 'Now read it.',
      tools: [
        {
          toolCallId: 'tc-2',
          name: 'read_file',
          status: 'done',
          args: { path: 'src/foo.ts' },
          result: { content: 'ok' },
        },
      ],
    },
  ],
})

describe('parsePart reasoning duration', () => {
  it('keeps a positive finite duration on a reasoning part', () => {
    expect(parsePart({ type: 'reasoning', text: 'think', duration: 4 })).toEqual({
      type: 'reasoning',
      text: 'think',
      duration: 4,
    })
  })

  it('omits duration when it is missing or not a positive finite number', () => {
    expect(parsePart({ type: 'reasoning', text: 'think' })).toEqual({
      type: 'reasoning',
      text: 'think',
    })
    expect(parsePart({ type: 'reasoning', text: 'think', duration: 0 })).toEqual({
      type: 'reasoning',
      text: 'think',
    })
    expect(parsePart({ type: 'reasoning', text: 'think', duration: -1 })).toEqual({
      type: 'reasoning',
      text: 'think',
    })
    expect(parsePart({ type: 'reasoning', text: 'think', duration: Infinity })).toEqual({
      type: 'reasoning',
      text: 'think',
    })
    expect(parsePart({ type: 'reasoning', text: 'think', duration: '4' })).toEqual({
      type: 'reasoning',
      text: 'think',
    })
  })

  it('sums durations across reasoning parts and ignores parts without duration', () => {
    expect(
      extractReasoningDuration([
        { type: 'reasoning', text: 'a', duration: 2 } as never,
        { type: 'text', text: 'hi' },
        { type: 'reasoning', text: 'b' },
        { type: 'reasoning', text: 'c', duration: 3 } as never,
      ]),
    ).toBe(5)
  })

  it('returns undefined when no reasoning part has a duration', () => {
    expect(
      extractReasoningDuration([
        { type: 'reasoning', text: 'old' },
        { type: 'text', text: 'hi' },
      ]),
    ).toBeUndefined()
  })
})

describe('updateAssistantMessage tool projection', () => {
  it('creates a UIMessage for a tool-only turn', () => {
    const session = createSession('proj', 'chat-1')
    const turn = toolTurn()
    updateAssistantMessage(session, turn)

    expect(session.messages.value).toHaveLength(1)
    const message = session.messages.value[0]
    expect(message?.id).toBe('turn-1')
    expect(message?.role).toBe('assistant')
    expect(message?.parts).toEqual([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { path: 'a.ts' },
        output: { content: 'ok' },
      },
    ])
  })

  it('emits step reasoning and text before that step tools', () => {
    const session = createSession('proj', 'chat-1')
    const turn: AgentTurn = {
      id: 'turn-1',
      text: '',
      steps: [
        {
          id: 'step-1',
          text: 'checking',
          reasoning: 'think',
          tools: [
            {
              toolCallId: 'tc-1',
              name: 'read_file',
              status: 'done',
              args: { path: 'a.ts' },
              result: { content: 'ok' },
            },
          ],
        },
      ],
    }
    updateAssistantMessage(session, turn)

    expect(session.messages.value[0]?.parts.map((part) => part.type)).toEqual([
      'reasoning',
      'text',
      'step-start',
      'dynamic-tool',
    ])
    expect(session.messages.value[0]?.parts[1]).toEqual({
      type: 'text',
      text: 'checking',
    })
  })

  it('places trailing turn text after step tools', () => {
    const session = createSession('proj', 'chat-1')
    updateAssistantMessage(session, toolTurn('done'))

    expect(session.messages.value[0]?.parts.map((part) => part.type)).toEqual([
      'step-start',
      'dynamic-tool',
      'text',
    ])
    expect(session.messages.value[0]?.parts.at(-1)).toEqual({
      type: 'text',
      text: 'done',
    })
  })

  it('projects multi-step text and tools in chronological order', () => {
    const session = createSession('proj', 'chat-1')
    updateAssistantMessage(session, multiStepTurn())

    expect(session.messages.value[0]?.parts).toEqual([
      { type: 'reasoning', text: 'Search first.' },
      { type: 'text', text: 'I will search.' },
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'grep',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { pattern: 'TODO' },
        output: { matches: 1 },
      },
      { type: 'reasoning', text: 'Now read it.' },
      { type: 'text', text: 'Opening the file.' },
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'read_file',
        toolCallId: 'tc-2',
        state: 'output-available',
        input: { path: 'src/foo.ts' },
        output: { content: 'ok' },
      },
      { type: 'text', text: 'Here is what I found.' },
    ])
  })

  it('skips empty turns with no tools', () => {
    const session = createSession('proj', 'chat-1')
    updateAssistantMessage(session, {
      id: 'turn-empty',
      text: '',
      steps: [{ id: 'step-1', text: '', reasoning: '', tools: [] }],
    })
    expect(session.messages.value).toEqual([])
  })
})

describe('rebuildMessagesFromTimeline tool projection', () => {
  it('projects tool runs onto assistant message parts', () => {
    const messages = rebuildMessagesFromTimeline([
      { type: 'agent-turn', turn: toolTurn('hello') },
    ])
    expect(messages).toHaveLength(1)
    expect(messages[0]?.parts).toEqual([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { path: 'a.ts' },
        output: { content: 'ok' },
      },
      { type: 'text', text: 'hello' },
    ])
  })

  it('matches buildAssistantMessage chronological ordering', () => {
    const turn = multiStepTurn()
    const rebuilt = rebuildMessagesFromTimeline([{ type: 'agent-turn', turn }])
    expect(rebuilt).toEqual([buildAssistantMessage(turn)])
  })
})

describe('convertToModelMessages with chronological assistant parts', () => {
  it('does not serialize later step narration before earlier tool calls', async () => {
    const message = buildAssistantMessage(multiStepTurn())
    const modelMessages = await convertToModelMessages([message])

    type TextOrTool =
      | { role: string; type: 'text'; text: string }
      | { role: string; type: 'tool-call'; toolCallId: string }
      | { role: string; type: 'tool-result'; toolCallId: string }
    const textAndTools: TextOrTool[] = []
    for (const item of modelMessages) {
      if (!Array.isArray(item.content)) {
        continue
      }
      for (const part of item.content) {
        if (part.type === 'text') {
          textAndTools.push({ role: item.role, type: 'text', text: part.text })
          continue
        }
        if (part.type === 'tool-call') {
          textAndTools.push({
            role: item.role,
            type: 'tool-call',
            toolCallId: part.toolCallId,
          })
          continue
        }
        if (part.type === 'tool-result') {
          textAndTools.push({
            role: item.role,
            type: 'tool-result',
            toolCallId: part.toolCallId,
          })
        }
      }
    }

    // step-start flushes the current block, so step text lands before that
    // step's tools. Later step text stays after the earlier tool-call.
    expect(textAndTools).toEqual([
      { role: 'assistant', type: 'text', text: 'I will search.' },
      { role: 'assistant', type: 'tool-call', toolCallId: 'tc-1' },
      { role: 'assistant', type: 'text', text: 'Opening the file.' },
      { role: 'tool', type: 'tool-result', toolCallId: 'tc-1' },
      { role: 'assistant', type: 'tool-call', toolCallId: 'tc-2' },
      { role: 'assistant', type: 'text', text: 'Here is what I found.' },
      { role: 'tool', type: 'tool-result', toolCallId: 'tc-2' },
    ])
  })
})
