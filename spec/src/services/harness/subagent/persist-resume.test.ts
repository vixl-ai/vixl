import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelMessage } from 'ai'

const upsertChatLine = vi.hoisted(() =>
  vi.fn<(_slug: string, _chatId: string, line: Record<string, unknown>) => Promise<void>>(),
)
const nowIso = vi.hoisted(() => vi.fn<() => string>(() => new Date().toISOString()))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  upsertChatLine: (
    projectSlug: string,
    chatId: string,
    line: Record<string, unknown>,
  ) => upsertChatLine(projectSlug, chatId, line),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() },
}))

vi.mock('@/services/harness/orchestrator/helpers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/harness/orchestrator/helpers')>()
  return {
    ...actual,
    nowIso: () => nowIso(),
  }
})

import { toast } from 'vue-sonner'
import {
  flushSubagentResumePersist,
  persistSubagentResume,
  queueSubagentResumeSnapshot,
  resetSubagentResumePersistForTests,
  subagentResumeLineId,
  type SubagentResumeSnapshot,
} from '@/services/harness/subagent/persist-resume'

const messages: ModelMessage[] = [
  { role: 'user', content: 'find the auth bug' },
  { role: 'assistant', content: 'looking' },
]

const snapshot = (
  overrides?: Partial<SubagentResumeSnapshot>,
): SubagentResumeSnapshot => ({
  projectSlug: 'proj',
  chatId: 'chat-1',
  subagentId: 'sub-1',
  toolCallId: 'call-1',
  agentName: 'explore',
  blocking: true,
  prompt: 'find the auth bug',
  model: 'local::qwen',
  capabilities: 'read-only',
  messages,
  ...overrides,
})

describe('persistSubagentResume', () => {
  beforeEach(() => {
    upsertChatLine.mockReset()
    upsertChatLine.mockResolvedValue(undefined)
    nowIso.mockReset()
    nowIso.mockImplementation(() => new Date().toISOString())
    resetSubagentResumePersistForTests()
  })

  it('writes a subagent-resume harness line with the stable id', async () => {
    await persistSubagentResume(snapshot())

    expect(upsertChatLine).toHaveBeenCalledTimes(1)
    const line = upsertChatLine.mock.calls[0]?.[2]
    expect(upsertChatLine).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      expect.objectContaining({
        id: 'subagent-resume:sub-1',
        role: 'assistant',
        parts: [],
        harnessEvent: {
          type: 'subagent-resume',
          subagentId: 'sub-1',
          toolCallId: 'call-1',
          agentName: 'explore',
          blocking: true,
          prompt: 'find the auth bug',
          model: 'local::qwen',
          capabilities: 'read-only',
          messages,
        },
      }),
    )
    expect(typeof line?.createdAt).toBe('string')
    expect(line?.createdAt).not.toBe('')
    expect(subagentResumeLineId('sub-1')).toBe('subagent-resume:sub-1')
  })

  it('includes workspace on the harness event when present', async () => {
    const workspace = { projectRoot: '/tmp/wt', projectSlug: 'feature' }
    await persistSubagentResume(snapshot({ workspace }))

    expect(upsertChatLine).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      expect.objectContaining({
        harnessEvent: expect.objectContaining({
          type: 'subagent-resume',
          workspace,
        }),
      }),
    )
  })

  it('reuses the same line id on repeated persists', async () => {
    await persistSubagentResume(snapshot({ messages: [{ role: 'user', content: 'one' }] }))
    await persistSubagentResume(
      snapshot({ messages: [{ role: 'user', content: 'two' }] }),
    )

    expect(upsertChatLine).toHaveBeenCalledTimes(2)
    expect(upsertChatLine.mock.calls[0]?.[2]?.id).toBe('subagent-resume:sub-1')
    expect(upsertChatLine.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        id: 'subagent-resume:sub-1',
        harnessEvent: expect.objectContaining({
          messages: [{ role: 'user', content: 'two' }],
        }),
      }),
    )
  })
})

describe('queueSubagentResumeSnapshot', () => {
  beforeEach(() => {
    upsertChatLine.mockReset()
    upsertChatLine.mockResolvedValue(undefined)
    nowIso.mockReset()
    nowIso.mockImplementation(() => new Date().toISOString())
    vi.mocked(toast.error).mockClear()
    resetSubagentResumePersistForTests()
  })

  it('serializes per subagent so a newer snapshot is the last write', async () => {
    let releaseFirst = (): void => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    upsertChatLine.mockImplementationOnce(async () => {
      await firstGate
    })
    upsertChatLine.mockResolvedValueOnce(undefined)

    queueSubagentResumeSnapshot(
      snapshot({ messages: [{ role: 'user', content: 'older' }] }),
    )
    await Promise.resolve()
    queueSubagentResumeSnapshot(
      snapshot({ messages: [{ role: 'user', content: 'newer' }] }),
    )

    expect(upsertChatLine).toHaveBeenCalledTimes(1)
    releaseFirst()
    await flushSubagentResumePersist('sub-1')

    expect(upsertChatLine).toHaveBeenCalledTimes(2)
    expect(upsertChatLine.mock.calls[0]?.[2]?.id).toBe('subagent-resume:sub-1')
    expect(upsertChatLine.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        id: 'subagent-resume:sub-1',
        harnessEvent: expect.objectContaining({
          messages: [{ role: 'user', content: 'newer' }],
        }),
      }),
    )
  })

  it('rejects flush when the latest snapshot write fails and toasts', async () => {
    const persistError = new Error('disk full')
    upsertChatLine.mockRejectedValueOnce(persistError)

    queueSubagentResumeSnapshot(snapshot())

    await expect(flushSubagentResumePersist('sub-1')).rejects.toBe(persistError)
    await expect(flushSubagentResumePersist()).resolves.toBeUndefined()
    expect(toast.error).toHaveBeenCalledWith('Failed to save subagent resume snapshot', {
      description: 'disk full',
    })
  })

  it('clears a prior persist failure after a later successful snapshot', async () => {
    const persistError = new Error('disk full')
    upsertChatLine.mockRejectedValueOnce(persistError)
    upsertChatLine.mockResolvedValueOnce(undefined)

    queueSubagentResumeSnapshot(
      snapshot({ messages: [{ role: 'user', content: 'older' }] }),
    )
    await expect(flushSubagentResumePersist('sub-1')).rejects.toBe(persistError)

    queueSubagentResumeSnapshot(
      snapshot({ messages: [{ role: 'user', content: 'newer' }] }),
    )
    await expect(flushSubagentResumePersist('sub-1')).resolves.toBeUndefined()

    expect(upsertChatLine).toHaveBeenCalledTimes(2)
    expect(upsertChatLine.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        id: 'subagent-resume:sub-1',
        harnessEvent: expect.objectContaining({
          messages: [{ role: 'user', content: 'newer' }],
        }),
      }),
    )
  })

  it('scopes a no-id flush to one chat so another chat cannot delay or reject it', async () => {
    let releaseChatA = (): void => undefined
    const chatAGate = new Promise<void>((resolve) => {
      releaseChatA = resolve
    })
    const persistError = new Error('chat a disk full')
    upsertChatLine.mockImplementation(async (_slug, chatId) => {
      if (chatId === 'chat-a') {
        await chatAGate
        throw persistError
      }
    })

    queueSubagentResumeSnapshot(
      snapshot({
        chatId: 'chat-a',
        subagentId: 'sub-a',
        toolCallId: 'call-a',
      }),
    )
    queueSubagentResumeSnapshot(
      snapshot({
        chatId: 'chat-b',
        subagentId: 'sub-b',
        toolCallId: 'call-b',
      }),
    )

    await expect(flushSubagentResumePersist(undefined, 'chat-b')).resolves.toBeUndefined()

    releaseChatA()
    await expect(flushSubagentResumePersist('sub-a')).rejects.toBe(persistError)
    await expect(flushSubagentResumePersist(undefined, 'chat-b')).resolves.toBeUndefined()
  })

  it('does not reject a chat flush for a settled failure, then consumes an in-flight one', async () => {
    const settledError = new Error('sub-a disk full')
    const inFlightError = new Error('sub-b disk full')
    let releaseB = (): void => undefined
    const bGate = new Promise<void>((resolve) => {
      releaseB = resolve
    })
    upsertChatLine.mockImplementation(async (_slug, _chatId, line) => {
      const event = line.harnessEvent as { subagentId?: string }
      if (event.subagentId === 'sub-a') {
        throw settledError
      }
      if (event.subagentId === 'sub-b') {
        await bGate
        throw inFlightError
      }
    })

    queueSubagentResumeSnapshot(
      snapshot({
        chatId: 'chat-a',
        subagentId: 'sub-a',
        toolCallId: 'call-a',
      }),
    )
    await Promise.resolve()
    await expect(upsertChatLine.mock.results[0]?.value).rejects.toBe(settledError)
    await Promise.resolve()

    await expect(flushSubagentResumePersist(undefined, 'chat-a')).resolves.toBeUndefined()

    queueSubagentResumeSnapshot(
      snapshot({
        chatId: 'chat-a',
        subagentId: 'sub-b',
        toolCallId: 'call-b',
      }),
    )
    const inFlightFlush = flushSubagentResumePersist(undefined, 'chat-a')
    releaseB()
    await expect(inFlightFlush).rejects.toBe(inFlightError)
    await expect(flushSubagentResumePersist(undefined, 'chat-a')).resolves.toBeUndefined()
  })

  it('does not fail flush when a superseded generation fails after a newer snapshot succeeds', async () => {
    let releaseFirst = (): void => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const persistError = new Error('stale write')
    upsertChatLine.mockImplementationOnce(async () => {
      await firstGate
      throw persistError
    })
    upsertChatLine.mockResolvedValueOnce(undefined)

    queueSubagentResumeSnapshot(
      snapshot({ messages: [{ role: 'user', content: 'older' }] }),
    )
    await Promise.resolve()
    queueSubagentResumeSnapshot(
      snapshot({ messages: [{ role: 'user', content: 'newer' }] }),
    )

    releaseFirst()
    await expect(flushSubagentResumePersist('sub-1')).resolves.toBeUndefined()

    expect(upsertChatLine).toHaveBeenCalledTimes(2)
    expect(upsertChatLine.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        id: 'subagent-resume:sub-1',
        harnessEvent: expect.objectContaining({
          messages: [{ role: 'user', content: 'newer' }],
        }),
      }),
    )
  })

  it('persists the createdAt captured at queue time when the upsert is delayed', async () => {
    let releaseFirst = (): void => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    upsertChatLine.mockImplementationOnce(async () => {
      await firstGate
    })
    nowIso.mockReturnValue('2026-01-01T00:00:01.000Z')

    queueSubagentResumeSnapshot(snapshot())
    await Promise.resolve()

    nowIso.mockReturnValue('2026-01-01T00:00:02.000Z')
    releaseFirst()
    await flushSubagentResumePersist('sub-1')

    expect(upsertChatLine).toHaveBeenCalledTimes(1)
    expect(upsertChatLine.mock.calls[0]?.[2]?.createdAt).toBe(
      '2026-01-01T00:00:01.000Z',
    )
  })
})
