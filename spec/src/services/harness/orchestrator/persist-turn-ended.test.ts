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
import type { HarnessEvent } from '@/types/harness/harness-event'

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

describe('persistSubagentHarnessEvent nested live events', () => {
  beforeEach(() => {
    appendChatLine.mockReset()
    appendChatLine.mockResolvedValue(undefined)
  })

  const nested = (event: HarnessEvent) =>
    persistSubagentHarnessEvent('proj', 'chat-1', {
      type: 'subagent-event',
      subagentId: 'sub-1',
      parentToolCallId: 'call-1',
      event,
    })

  it('skips nested reasoning-delta, text-delta, and reasoning-duration', async () => {
    await nested({
      type: 'reasoning-delta',
      delta: 'think',
      stepId: 'step-1',
    })
    await nested({
      type: 'text-delta',
      delta: 'hello',
      stepId: 'step-1',
    })
    await nested({
      type: 'reasoning-duration',
      stepId: 'step-1',
      seconds: 2,
    })

    expect(appendChatLine).not.toHaveBeenCalled()
  })

  it('persists nested step-content snapshots', async () => {
    await nested({
      type: 'step-content',
      stepId: 'step-1',
      reasoning: 'think',
      reasoningSeconds: 2,
      text: 'hello',
    })

    expect(appendChatLine).toHaveBeenCalledTimes(1)
    expect(appendChatLine).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      expect.objectContaining({
        role: 'assistant',
        parts: [],
        harnessEvent: {
          type: 'subagent-event',
          subagentId: 'sub-1',
          parentToolCallId: 'call-1',
          event: {
            type: 'step-content',
            stepId: 'step-1',
            reasoning: 'think',
            reasoningSeconds: 2,
            text: 'hello',
          },
        },
      }),
    )
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
