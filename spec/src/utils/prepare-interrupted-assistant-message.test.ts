import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import prepareInterruptedAssistantMessage from '@/utils/prepare-interrupted-assistant-message'

const completedTool = {
  type: 'dynamic-tool' as const,
  toolName: 'read_file',
  toolCallId: 'tc-done',
  state: 'output-available' as const,
  input: { path: 'a.ts' },
  output: { content: 'ok' },
}

const stoppedTool = {
  type: 'dynamic-tool' as const,
  toolName: 'grep',
  toolCallId: 'tc-stopped',
  state: 'output-available' as const,
  input: { pattern: 'TODO' },
  output: { stopped: true },
}

const inputlessTool = {
  type: 'dynamic-tool' as const,
  toolName: 'read_file',
  toolCallId: 'tc-open',
  state: 'input-streaming' as const,
}

describe('prepareInterruptedAssistantMessage', () => {
  it('drops dynamic-tool parts with no input', () => {
    const messages: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'go' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'working' },
          { type: 'step-start' },
          completedTool,
          inputlessTool,
        ],
      },
    ]

    expect(prepareInterruptedAssistantMessage(messages)).toEqual([
      messages[0],
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'working' },
          { type: 'step-start' },
          completedTool,
        ],
      },
    ])
  })

  it('converts stopped tool output to output-error', () => {
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'step-start' }, stoppedTool],
      },
    ]

    expect(prepareInterruptedAssistantMessage(messages)).toEqual([
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'dynamic-tool',
            toolName: 'grep',
            toolCallId: 'tc-stopped',
            state: 'output-error',
            input: { pattern: 'TODO' },
            errorText: 'Interrupted by provider error',
          },
        ],
      },
    ])
  })

  it('leaves completed tools untouched and keeps part order', () => {
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'checking' },
          { type: 'step-start' },
          completedTool,
          stoppedTool,
          inputlessTool,
          { type: 'text', text: 'next' },
        ],
      },
    ]

    expect(prepareInterruptedAssistantMessage(messages)[0]?.parts).toEqual([
      { type: 'text', text: 'checking' },
      { type: 'step-start' },
      completedTool,
      {
        type: 'dynamic-tool',
        toolName: 'grep',
        toolCallId: 'tc-stopped',
        state: 'output-error',
        input: { pattern: 'TODO' },
        errorText: 'Interrupted by provider error',
      },
      { type: 'text', text: 'next' },
    ])
  })

  it('does not change a trailing non-assistant message', () => {
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'step-start' }, stoppedTool, inputlessTool],
      },
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: 'keep going' }],
      },
    ]

    expect(prepareInterruptedAssistantMessage(messages)).toBe(messages)
  })
})
