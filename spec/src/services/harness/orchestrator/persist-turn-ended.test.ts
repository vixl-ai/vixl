import { beforeEach, describe, expect, it, vi } from 'vitest'

const appendChatLine = vi.hoisted(() =>
  vi.fn<(_slug: string, _chatId: string, line: Record<string, unknown>) => Promise<void>>(),
)

vi.mock('@/services/vixl/vixl-tauri', () => ({
  appendChatLine: (
    projectSlug: string,
    chatId: string,
    line: Record<string, unknown>,
  ) => appendChatLine(projectSlug, chatId, line),
}))

import {
  persistSubagentHarnessEvent,
  persistTurnEnded,
} from '@/services/harness/orchestrator/persistence'

describe('persistTurnEnded', () => {
  beforeEach(() => {
    appendChatLine.mockReset()
    appendChatLine.mockResolvedValue(undefined)
  })

  it('writes a turn-ended harness line keyed by turn id', async () => {
    await persistTurnEnded('proj', 'chat-1', 'turn-1', {
      reason: 'completed',
      finish: 'stop',
      detail: 'done',
    })

    expect(appendChatLine).toHaveBeenCalledTimes(1)
    const line = appendChatLine.mock.calls[0]?.[2]
    expect(appendChatLine).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      expect.objectContaining({
        id: 'turn-1-ended',
        role: 'assistant',
        parts: [],
        harnessEvent: {
          type: 'turn-ended',
          turnId: 'turn-1',
          stop: { reason: 'completed', finish: 'stop', detail: 'done' },
        },
      }),
    )
    expect(typeof line?.createdAt).toBe('string')
    expect(line?.createdAt).not.toBe('')
  })
})

describe('persistSubagentHarnessEvent stop', () => {
  beforeEach(() => {
    appendChatLine.mockReset()
    appendChatLine.mockResolvedValue(undefined)
  })

  it('persists stop on a subagent-result event', async () => {
    await persistSubagentHarnessEvent('proj', 'chat-1', {
      type: 'subagent-result',
      subagentId: 'sub-1',
      summary: 'found it',
      blocking: true,
      outcome: 'completed',
      stop: { reason: 'failed', detail: 'tool error' },
    })

    expect(appendChatLine).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      expect.objectContaining({
        id: 'sub-1-result',
        role: 'assistant',
        parts: [],
        harnessEvent: {
          type: 'subagent-result',
          subagentId: 'sub-1',
          summary: 'found it',
          blocking: true,
          outcome: 'completed',
          stop: { reason: 'failed', detail: 'tool error' },
        },
      }),
    )
  })
})
