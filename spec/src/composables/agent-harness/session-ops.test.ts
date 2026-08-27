import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { AgentHarnessState } from '@/composables/agent-harness/types'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const compactSession = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{
    summary: string
    checkpointLineId: string
    includeFromCreatedAt: string
  }>>(),
)
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const toastSuccess = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('@/services/harness/compact-session', () => ({
  default: (...args: unknown[]) => compactSession(...args),
}))

vi.mock('@/services/harness/write-handoff', () => ({
  default: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  createChat: vi.fn<(...args: unknown[]) => Promise<{ id: string }>>(),
}))

vi.mock('@/services/chat/pending-message', () => ({
  setPendingChatMessage: vi.fn<(...args: unknown[]) => void>(),
}))

vi.mock('@/utils/chat-route-for', () => ({
  default: () => '/chat',
}))

vi.mock('@/router', () => ({
  default: { push: vi.fn<(...args: unknown[]) => Promise<void>>() },
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

import createSessionOps from '@/composables/agent-harness/session-ops'

const settings = (): VixlSettings => ({ version: 1 })

describe('sessionOps compactChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    compactSession.mockResolvedValue({
      summary: 'Short recap',
      checkpointLineId: 'cp-1',
      includeFromCreatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('aborts the parent turn then compacts when the parent is streaming', async () => {
    const status = ref<'ready' | 'streaming' | 'submitted'>('streaming')
    const stop = vi.fn<() => Promise<void>>().mockImplementation(async () => {
      status.value = 'ready'
    })
    const appendLocalCompaction = vi.fn<(...args: unknown[]) => void>()
    const patchMetaActiveContext = vi.fn<(...args: unknown[]) => void>()
    const clearLastStepUsage = vi.fn<() => void>()

    const state = {
      options: {
        projectSlug: 'proj',
        chatId: 'chat-1',
        projectRoot: '/tmp/proj',
      },
      session: {
        meta: computed(() => ({
          model: 'local::qwen',
          mode: 'agent',
          title: 'Chat',
        })),
        messages: computed(() => []),
        activeTurnId: computed(() => 'turn-1'),
        appendLocalCompaction,
        patchMetaActiveContext,
      },
      config: {
        effectiveSettings: computed(() => settings()),
      },
      status,
      contextUsage: { clearLastStepUsage },
    } as unknown as AgentHarnessState

    const { compactChat } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      stop,
    })

    await compactChat()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(compactSession).toHaveBeenCalledTimes(1)
    expect(appendLocalCompaction).toHaveBeenCalledWith('Short recap', null)
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('does not abort when the parent is ready', async () => {
    const stop = vi.fn<() => Promise<void>>()
    const state = {
      options: {
        projectSlug: 'proj',
        chatId: 'chat-1',
        projectRoot: '/tmp/proj',
      },
      session: {
        meta: computed(() => ({
          model: 'local::qwen',
          mode: 'agent',
          title: 'Chat',
        })),
        messages: computed(() => []),
        activeTurnId: computed(() => 'turn-1'),
        appendLocalCompaction: vi.fn<(...args: unknown[]) => void>(),
        patchMetaActiveContext: vi.fn<(...args: unknown[]) => void>(),
      },
      config: {
        effectiveSettings: computed(() => settings()),
      },
      status: ref('ready'),
      contextUsage: { clearLastStepUsage: vi.fn<() => void>() },
    } as unknown as AgentHarnessState

    const { compactChat } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      stop,
    })

    await compactChat()

    expect(stop).not.toHaveBeenCalled()
    expect(compactSession).toHaveBeenCalledTimes(1)
  })
})
