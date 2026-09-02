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
const writeHandoff = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/services/harness/compact-session', () => ({
  default: (...args: unknown[]) => compactSession(...args),
}))

vi.mock('@/services/harness/write-handoff', () => ({
  default: (...args: unknown[]) => writeHandoff(...args),
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

const compactResult = {
  summary: 'Short recap',
  checkpointLineId: 'cp-1',
  includeFromCreatedAt: '2026-01-01T00:00:00.000Z',
}

const buildState = (overrides?: {
  status?: 'ready' | 'streaming' | 'submitted'
  compacting?: boolean
  staleSummary?: string
}): AgentHarnessState => {
  const compacting = ref(overrides?.compacting ?? false)
  return {
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
        ...(overrides?.staleSummary
          ? {
              activeContext: {
                checkpointLineId: 'stale-cp',
                includeFromCreatedAt: '2026-01-01T00:00:00.000Z',
                summary: overrides.staleSummary,
              },
            }
          : {}),
      })),
      messages: computed(() => []),
      timeline: computed(() => []),
      activeTurnId: computed(() => 'turn-1'),
      appendLocalCompaction: vi.fn<(...args: unknown[]) => void>(),
      patchMetaActiveContext: vi.fn<(...args: unknown[]) => void>(),
    },
    config: {
      effectiveSettings: computed(() => settings()),
    },
    status: ref(overrides?.status ?? 'ready'),
    compacting,
    contextUsage: { clearLastStepUsage: vi.fn<() => void>() },
  } as unknown as AgentHarnessState
}

describe('sessionOps compactChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    compactSession.mockResolvedValue(compactResult)
  })

  it('sets compacting true while in flight and false after resolve', async () => {
    let release: (() => void) | undefined
    compactSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(compactResult)
        }),
    )
    const state = buildState()
    const maybeDrainQueue = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined)
    const { compactChat } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue,
    })

    const pending = compactChat()
    expect(state.compacting.value).toBe(true)
    expect(maybeDrainQueue).not.toHaveBeenCalled()

    release?.()
    await pending

    expect(state.compacting.value).toBe(false)
    expect(maybeDrainQueue).toHaveBeenCalledTimes(1)
  })

  it('clears compacting and drains after reject', async () => {
    compactSession.mockRejectedValue(new Error('summarizer down'))
    const state = buildState()
    const maybeDrainQueue = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined)
    const { compactChat } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue,
    })

    await compactChat()

    expect(state.compacting.value).toBe(false)
    expect(maybeDrainQueue).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(
      'Compaction failed',
      expect.objectContaining({ description: 'summarizer down' }),
    )
  })

  it('toasts and does not stop when the parent is streaming', async () => {
    const stop = vi.fn<() => Promise<void>>()
    const state = buildState({ status: 'streaming' })
    const maybeDrainQueue = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined)
    const { compactChat } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue,
    })

    await compactChat()

    expect(stop).not.toHaveBeenCalled()
    expect(compactSession).not.toHaveBeenCalled()
    expect(maybeDrainQueue).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Stop generating first')
  })

  it('toasts and does not compact when the parent is submitted', async () => {
    const state = buildState({ status: 'submitted' })
    const maybeDrainQueue = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined)
    const { compactChat } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue,
    })

    await compactChat()

    expect(compactSession).not.toHaveBeenCalled()
    expect(maybeDrainQueue).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Stop generating first')
  })

  it('does not compact again while already compacting', async () => {
    let release: (() => void) | undefined
    compactSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(compactResult)
        }),
    )
    const state = buildState()
    const { compactChat } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    })

    const first = compactChat()
    await compactChat()
    expect(compactSession).toHaveBeenCalledTimes(1)

    release?.()
    await first
    expect(compactSession).toHaveBeenCalledTimes(1)
  })

  it('does not abort when the parent is ready', async () => {
    const state = buildState()
    const { compactChat } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    })

    await compactChat()

    expect(compactSession).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalled()
  })
})

describe('sessionOps createHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    compactSession.mockResolvedValue(compactResult)
  })

  it('toasts and does not compact when the parent is streaming', async () => {
    const state = buildState({ status: 'streaming' })
    const { createHandoff } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    })

    await createHandoff()

    expect(compactSession).not.toHaveBeenCalled()
    expect(writeHandoff).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Stop generating first')
  })

  it('is a no-op when already compacting', async () => {
    const state = buildState({ compacting: true })
    const { createHandoff } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    })

    await createHandoff()

    expect(compactSession).not.toHaveBeenCalled()
    expect(writeHandoff).not.toHaveBeenCalled()
  })

  it('sets compacting while generating a missing summary', async () => {
    let release: (() => void) | undefined
    compactSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(compactResult)
        }),
    )
    const state = buildState()
    const { createHandoff } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    })

    const pending = createHandoff()
    expect(state.compacting.value).toBe(true)
    expect(writeHandoff).not.toHaveBeenCalled()

    release?.()
    await pending

    expect(state.compacting.value).toBe(false)
    expect(compactSession).toHaveBeenCalledTimes(1)
  })

  it('always generates a fresh summary instead of reusing activeContext', async () => {
    const state = buildState({ staleSummary: 'stale stored summary' })
    const { createHandoff } = createSessionOps(state, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      maybeDrainQueue: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    })

    await createHandoff()

    expect(compactSession).toHaveBeenCalledTimes(1)
    expect(writeHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ summary: compactResult.summary }),
    )
  })
})
