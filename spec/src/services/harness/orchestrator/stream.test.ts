import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessStreamInput } from '@/types/harness/harness-stream-input'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const hasRunningSubagentsForChat = vi.hoisted(() =>
  vi.fn<(chatId: string) => boolean>(),
)
const consumeStream = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const prepareStream = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
    steps: { stepCount: 0 },
  }),
)
const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    updateChatMeta: (...args: unknown[]) => updateChatMeta(...args),
  }),
)

vi.mock('@/services/harness/permission/approval-gate', () => ({
  rejectPendingForChat: vi.fn<() => void>(),
}))

vi.mock('@/services/harness/permission/question-gate', () => ({
  rejectPendingQuestionsForChat: vi.fn<() => void>(),
}))

vi.mock('@/services/mcp/mcp-auth-gate', () => ({
  rejectPendingMcpAuthForChat: vi.fn<() => void>(),
}))

vi.mock('@/services/harness/shell/registry', () => ({
  setAgentShellEventEmitter: vi.fn<() => void>(),
}))

vi.mock('@/services/harness/subagent/registry', () => ({
  hasRunningSubagentsForChat: (chatId: string) =>
    hasRunningSubagentsForChat(chatId),
}))

vi.mock('@/services/harness/orchestrator/consume-stream', () => ({
  default: (...args: unknown[]) => consumeStream(...args),
}))

vi.mock('@/services/harness/orchestrator/prepare-stream', () => ({
  default: (...args: unknown[]) => prepareStream(...args),
}))

import runStream from '@/services/harness/orchestrator/stream'

const buildInput = (signal: AbortSignal): HarnessStreamInput =>
  ({
    projectSlug: 'proj',
    chatId: 'chat-1',
    signal,
    onEvent: vi.fn<(...args: unknown[]) => void>(),
  }) as unknown as HarnessStreamInput

describe('harness stream status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consumeStream.mockResolvedValue(undefined)
    prepareStream.mockResolvedValue({ steps: { stepCount: 0 } })
    updateChatMeta.mockResolvedValue(undefined)
    hasRunningSubagentsForChat.mockReturnValue(false)
  })

  it('marks the chat idle when no background subagents are running', async () => {
    await runStream(buildInput(new AbortController().signal))

    expect(updateChatMeta).toHaveBeenCalledWith('proj', 'chat-1', {
      status: 'idle',
    })
  })

  it('keeps sidebar running while background subagents are still working', async () => {
    hasRunningSubagentsForChat.mockReturnValue(true)

    await runStream(buildInput(new AbortController().signal))

    expect(updateChatMeta).toHaveBeenCalledWith('proj', 'chat-1', {
      status: 'running',
    })
  })

  it('still settles status when the stream is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    hasRunningSubagentsForChat.mockReturnValue(true)

    await runStream(buildInput(controller.signal))

    expect(updateChatMeta).toHaveBeenCalledWith('proj', 'chat-1', {
      status: 'running',
    })
  })
})
