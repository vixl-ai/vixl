import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import boundRewrittenMessages from '@/services/harness/compact/bound-rewritten-messages'
import { compactBudgets, estimatePromptTokens } from '@/services/harness/compact'

const checkpoint = (summary: string): ModelMessage => ({
  role: 'user',
  content: `${compactBudgets.CHECKPOINT_PREFIX}\n${summary}`,
})

const toolCallIds = (messages: ModelMessage[]): string[] => {
  const ids: string[] = []
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      continue
    }
    for (const part of message.content) {
      if (part.type === 'tool-call') {
        ids.push(part.toolCallId)
      }
    }
  }
  return ids.sort()
}

const toolResultIds = (messages: ModelMessage[]): string[] => {
  const ids: string[] = []
  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      continue
    }
    for (const part of message.content) {
      if (part.type === 'tool-result') {
        ids.push(part.toolCallId)
      }
    }
  }
  return ids.sort()
}

const expectPairedTools = (messages: ModelMessage[]): void => {
  expect(toolCallIds(messages)).toEqual(toolResultIds(messages))
  for (const message of messages) {
    if (message.role === 'tool') {
      expect(Array.isArray(message.content)).toBe(true)
    }
  }
}

describe('boundRewrittenMessages', () => {
  it('truncates an oversized first user message to fit high water', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'x'.repeat(80_000) },
      checkpoint('short recap'),
    ]
    const system = 'sys'
    const highWater = 2_000

    const bounded = boundRewrittenMessages(messages, system, highWater)

    expect(estimatePromptTokens(system, bounded)).toBeLessThanOrEqual(highWater)
    expect(JSON.stringify(bounded[0]).length).toBeLessThan(
      JSON.stringify(messages[0]).length,
    )
    expectPairedTools(bounded)
  })

  it('truncates a huge tool result while keeping the matching tool-call pair', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      checkpoint('Auth recap'),
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'read_file',
            input: { path: 'login.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read_file',
            output: { type: 'text', value: 'y'.repeat(80_000) },
          },
        ],
      },
    ]
    const system = 'sys'
    const highWater = 3_000

    const bounded = boundRewrittenMessages(messages, system, highWater)

    expect(estimatePromptTokens(system, bounded)).toBeLessThanOrEqual(highWater)
    expect(JSON.stringify(bounded)).not.toContain('y'.repeat(80_000))
    expectPairedTools(bounded)
    const tool = bounded.find((message) => message.role === 'tool')
    expect(tool?.role).toBe('tool')
  })

  it('drops an orphaned tool result instead of turning it into a user message', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      checkpoint('Auth recap'),
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-orphan',
            toolName: 'read_file',
            output: { type: 'text', value: 'y'.repeat(80_000) },
          },
        ],
      },
    ]
    const system = 'sys'
    const highWater = 3_000

    const bounded = boundRewrittenMessages(messages, system, highWater)

    expect(estimatePromptTokens(system, bounded)).toBeLessThanOrEqual(highWater)
    expect(bounded.some((message) => message.role === 'tool')).toBe(false)
    expect(JSON.stringify(bounded)).not.toContain('tool-result')
    expectPairedTools(bounded)
  })

  it('drops unmatched assistant tool-calls when the tool result is removed', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'x'.repeat(20_000) },
      checkpoint('recap'),
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-2',
            toolName: 'read_file',
            input: { path: 'a.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-2',
            toolName: 'read_file',
            output: { type: 'text', value: 'z'.repeat(20_000) },
          },
        ],
      },
    ]
    const system = 'sys'
    const highWater = 800

    const bounded = boundRewrittenMessages(messages, system, highWater)

    expect(estimatePromptTokens(system, bounded)).toBeLessThanOrEqual(highWater)
    expectPairedTools(bounded)
  })
})
