import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import repairToolPairing from '@/services/harness/compact/repair-tool-pairing'

describe('repairToolPairing', () => {
  it('drops a tool result with no matching assistant tool-call', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read_file',
            output: { type: 'text', value: 'dump' },
          },
        ],
      },
    ]

    const repaired = repairToolPairing(messages)

    expect(repaired).toEqual([{ role: 'user', content: 'Find the auth bug.' }])
  })

  it('drops an assistant tool-call with no matching tool result', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
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
    ]

    const repaired = repairToolPairing(messages)

    expect(repaired).toEqual([{ role: 'user', content: 'Find the auth bug.' }])
  })

  it('keeps a matched tool-call and tool-result pair', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading login.' },
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
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ]

    expect(repairToolPairing(messages)).toEqual(messages)
  })
})
