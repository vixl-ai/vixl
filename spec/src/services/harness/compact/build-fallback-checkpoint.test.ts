import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import buildFallbackCheckpoint from '@/services/harness/compact/build-fallback-checkpoint'

describe('buildFallbackCheckpoint', () => {
  it('includes counts and snippets from the first user and latest message', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug in login.' },
      { role: 'assistant', content: 'Inspecting token refresh.' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read_file',
            output: { type: 'text', value: 'expired token handler' },
          },
        ],
      },
    ]

    const summary = buildFallbackCheckpoint(messages)

    expect(summary).toContain('Deterministic compaction fallback')
    expect(summary).toContain('Message count: 3')
    expect(summary).toContain('user=1')
    expect(summary).toContain('Find the auth bug in login.')
    expect(summary).toContain('expired token handler')
  })

  it('clips an oversized first user snippet', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'z'.repeat(10_000) },
    ]

    const summary = buildFallbackCheckpoint(messages)

    expect(summary.length).toBeLessThan(10_000)
    expect(summary).toContain('[truncated]')
  })
})
