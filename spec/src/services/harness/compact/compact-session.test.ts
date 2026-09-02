import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'

const summarizeTranscript = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{
    summary: string
    usage: undefined
    providerMetadata: undefined
    responseId: undefined
    modelRef: { providerId: string; modelId: string }
  }>>(),
)
const persistCompactionCheckpoint = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{
    summary: string
    includeFromCreatedAt: string
    checkpointLineId: string
  }>>(),
)

vi.mock('@/services/harness/compact', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/harness/compact')>()
  return {
    ...actual,
    summarizeTranscript: (...args: unknown[]) => summarizeTranscript(...args),
    persistCompactionCheckpoint: (...args: unknown[]) =>
      persistCompactionCheckpoint(...args),
  }
})

import compactSession from '@/services/harness/compact-session'

const settings = (): VixlSettings => ({ version: 1 })

const userMessage = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
})

describe('compactSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    summarizeTranscript.mockResolvedValue({
      summary: 'recap',
      usage: undefined,
      providerMetadata: undefined,
      responseId: undefined,
      modelRef: { providerId: 'ollama', modelId: 'qwen' },
    })
    persistCompactionCheckpoint.mockResolvedValue({
      summary: 'recap',
      includeFromCreatedAt: '2026-01-01T00:00:00.000Z',
      checkpointLineId: 'cp-1',
    })
  })

  it('throws before summarizing when the timeline transcript is empty', async () => {
    await expect(
      compactSession({
        projectSlug: 'proj',
        chatId: 'chat-1',
        projectRoot: '/tmp/proj',
        settings: settings(),
        messages: [],
        timeline: [],
      }),
    ).rejects.toThrow('Nothing to compact')

    expect(summarizeTranscript).not.toHaveBeenCalled()
    expect(persistCompactionCheckpoint).not.toHaveBeenCalled()
  })

  it('summarizes a tool-inclusive timeline transcript', async () => {
    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: userMessage('u1', 'check the file'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'a1',
          text: 'done',
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
                  args: { path: '/tmp/a.txt' },
                  result: { content: 'hello-tool-result' },
                },
              ],
            },
          ],
        },
      },
    ]

    await compactSession({
      projectSlug: 'proj',
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      settings: settings(),
      messages: [userMessage('u1', 'check the file')],
      timeline,
    })

    expect(summarizeTranscript).toHaveBeenCalledTimes(1)
    const call = summarizeTranscript.mock.calls[0]?.[0] as {
      transcript: string
    }
    expect(call.transcript).toContain('read_file')
    expect(call.transcript).toContain('hello-tool-result')
  })
})
