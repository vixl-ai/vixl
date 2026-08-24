import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import type { AgentHarnessState, AttentionHelpers } from '@/composables/agent-harness/types'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const releaseLocksForChat = vi.hoisted(() =>
  vi.fn<(chatId: string, cancelled?: string) => void>(),
)
const clearPendingBackgroundResume = vi.hoisted(() =>
  vi.fn<(chatId: string) => void>(),
)
const clearTurnResponseMessages = vi.hoisted(() =>
  vi.fn<(chatId: string) => void>(),
)
const shouldFlushBackgroundSubagentResume = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => 'resume' | 'clear' | 'noop'>(),
)
const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    updateChatMeta: (...args: unknown[]) => updateChatMeta(...args),
  }),
)

vi.mock('@/services/browser/registry', () => ({
  releaseLocksForChat: (...args: unknown[]) =>
    releaseLocksForChat(...(args as [string, string?])),
}))

vi.mock('@/services/harness/subagent/registry', () => ({
  clearPendingBackgroundResume: (chatId: string) =>
    clearPendingBackgroundResume(chatId),
  clearTurnResponseMessages: (chatId: string) =>
    clearTurnResponseMessages(chatId),
  hasPendingBackgroundResume: () => true,
  hasRunningSubagentsForChat: () => false,
  listDeliverableBackgroundResults: () => [],
}))

vi.mock('@/utils/should-flush-background-subagent-resume', () => ({
  default: (...args: unknown[]) => shouldFlushBackgroundSubagentResume(...args),
}))

vi.mock('@/services/harness/orchestrator', () => ({
  resumeOrchestrator: vi.fn<() => Promise<void>>(),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<() => void>(),
  },
}))

import createTurnLoop from '@/composables/agent-harness/turn-loop'

const buildState = (): AgentHarnessState =>
  ({
    options: {
      projectSlug: 'proj',
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      projectName: 'proj',
      standalone: false,
    },
    session: {
      patchMeta: vi.fn<(patch: unknown) => void>(),
      messages: ref([]),
      timeline: ref([]),
    },
    status: ref('ready'),
    error: ref(null),
    abortController: ref(null),
    lastRunConfig: ref(null),
    resumingBackgroundBatch: ref(false),
    sessionPermissionLevel: ref(null),
    fleetSidebar: {
      refreshSlug: vi.fn<(slug: string) => Promise<void>>(),
    },
    messageQueue: {
      take: vi.fn<() => undefined>(),
    },
    toolRuns: shallowRef([]),
    subagents: shallowRef([]),
    config: {
      hydrated: computed(() => true),
    },
  }) as unknown as AgentHarnessState

const buildAttention = (): AttentionHelpers =>
  ({
    isFullyIdle: () => true,
    refreshSidebar: vi.fn<() => void>(),
    applyTurnEndAttention: vi.fn<() => void>(),
  }) as unknown as AttentionHelpers

describe('maybeFlushBackgroundSubagentResume lock release', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateChatMeta.mockResolvedValue(undefined)
    shouldFlushBackgroundSubagentResume.mockReturnValue('noop')
  })

  it('releases locks with run_complete when background flush clears', () => {
    shouldFlushBackgroundSubagentResume.mockReturnValue('clear')
    const { maybeFlushBackgroundSubagentResume } = createTurnLoop(
      buildState(),
      buildAttention(),
      {
        handleEvent: vi.fn<() => void>(),
        persistPermission: vi
          .fn<() => Promise<void>>()
          .mockResolvedValue(undefined),
      },
    )

    maybeFlushBackgroundSubagentResume()

    expect(clearPendingBackgroundResume).toHaveBeenCalledWith('chat-1')
    expect(clearTurnResponseMessages).toHaveBeenCalledWith('chat-1')
    expect(releaseLocksForChat).toHaveBeenCalledWith('chat-1', 'run_complete')
  })

  it('does not release locks when flush is a noop', () => {
    const { maybeFlushBackgroundSubagentResume } = createTurnLoop(
      buildState(),
      buildAttention(),
      {
        handleEvent: vi.fn<() => void>(),
        persistPermission: vi
          .fn<() => Promise<void>>()
          .mockResolvedValue(undefined),
      },
    )

    maybeFlushBackgroundSubagentResume()

    expect(releaseLocksForChat).not.toHaveBeenCalled()
  })
})
