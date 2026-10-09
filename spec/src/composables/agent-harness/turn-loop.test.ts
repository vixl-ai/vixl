import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, ref, shallowRef } from 'vue'
import type { AgentHarnessState, AttentionHelpers } from '@/composables/agent-harness/types'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const useRealRegistryQueries = vi.hoisted(() => ({ current: false }))
const clearPendingBackgroundResume = vi.hoisted(() =>
  vi.fn<(chatId: string) => void>(),
)
const clearTurnResponseMessages = vi.hoisted(() =>
  vi.fn<(chatId: string) => void>(),
)
const listDeliverableBackgroundResults = vi.hoisted(() =>
  vi.fn<() => Array<{ toolCallId: string; result: { subagentId: string; name: string; summary: string } }>>(
    () => [],
  ),
)
const resumeOrchestrator = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const shouldFlushBackgroundSubagentResume = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => 'resume' | 'clear' | 'noop'>(),
)
const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
)
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const sendFn = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    updateChatMeta: (...args: unknown[]) => updateChatMeta(...args),
  }),
)

vi.mock('@/services/harness/subagent/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/harness/subagent/registry')>()
  return {
    ...actual,
    clearPendingBackgroundResume: (chatId: string) => {
      clearPendingBackgroundResume(chatId)
      actual.clearPendingBackgroundResume(chatId)
    },
    clearTurnResponseMessages: (chatId: string) => {
      clearTurnResponseMessages(chatId)
      actual.clearTurnResponseMessages(chatId)
    },
    hasPendingBackgroundResume: (chatId: string) =>
      useRealRegistryQueries.current
        ? actual.hasPendingBackgroundResume(chatId)
        : true,
    hasRunningSubagentsForChat: (chatId: string) =>
      useRealRegistryQueries.current
        ? actual.hasRunningSubagentsForChat(chatId)
        : false,
    listDeliverableBackgroundResults: (chatId: string) =>
      useRealRegistryQueries.current
        ? actual.listDeliverableBackgroundResults(chatId)
        : listDeliverableBackgroundResults(),
  }
})

vi.mock('@/utils/should-flush-background-subagent-resume', () => ({
  default: (...args: unknown[]) => shouldFlushBackgroundSubagentResume(...args),
}))

vi.mock('@/services/harness/orchestrator', () => ({
  resumeOrchestrator: (...args: unknown[]) => resumeOrchestrator(...args),
}))

vi.mock('@/composables/agent-harness/send', () => ({
  default: () => ({
    send: (...args: unknown[]) => sendFn(...args),
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import createHelpers from '@/composables/agent-harness/helpers'
import createTurnLoop from '@/composables/agent-harness/turn-loop'
import {
  clearPendingBackgroundResume as clearPendingViaRegistry,
  hasPendingBackgroundResume,
  listDeliverableBackgroundResults as listDeliverableViaRegistry,
  register as registerSubagent,
  resetSubagentRegistryForTests,
  resolve as resolveSubagent,
} from '@/services/harness/subagent/registry'

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
      startAgentTurn: vi.fn<(turnId: string) => void>(),
      finishAgentTurn: vi.fn<() => void>(),
      messages: ref([]),
      timeline: ref([]),
    },
    status: ref('ready'),
    error: ref(null),
    abortController: ref(null),
    lastRunConfig: ref(null),
    resumingBackgroundBatch: ref(false),
    sessionPermissionLevel: ref(null),
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
    fleetSidebar: {
      refreshSlug: vi.fn<(slug: string) => Promise<void>>(),
    },
    messageQueue: {
      take: vi.fn<() => undefined>(),
    },
    toolRuns: shallowRef([]),
    subagents: shallowRef([]),
    compacting: ref(false),
    disposed: ref(false),
    suppressQueueDrainAfterStop: ref(false),
    config: {
      hydrated: computed(() => true),
    },
  }) as unknown as AgentHarnessState

const flushPolicyFromArgs = (args: unknown): 'resume' | 'clear' | 'noop' => {
  const typed = args as {
    parentBusy: boolean
    hasPending: boolean
    hasRunning: boolean
    deliverableCount: number
  }
  if (!typed.hasPending) {
    return 'noop'
  }
  if (typed.parentBusy) {
    return 'noop'
  }
  if (typed.deliverableCount > 0) {
    return 'resume'
  }
  if (typed.hasRunning) {
    return 'noop'
  }
  return 'clear'
}

const queuedItem = {
  id: 'q-1',
  text: 'queued',
  files: [],
  mode: 'agent' as const,
  model: 'openai::gpt-4o',
}

const buildAttention = (
  state: AgentHarnessState,
  extras?: {
    isFullyIdle?: () => boolean
    isParentBusy?: () => boolean
  },
): AttentionHelpers =>
  ({
    isFullyIdle:
      extras?.isFullyIdle ??
      (() =>
        state.status.value !== 'streaming' &&
        state.status.value !== 'submitted' &&
        !state.resumingBackgroundBatch.value &&
        !state.compacting.value),
    isParentBusy:
      extras?.isParentBusy ??
      (() =>
        state.status.value === 'streaming' ||
        state.status.value === 'submitted' ||
        state.resumingBackgroundBatch.value ||
        state.compacting.value),
    refreshSidebar: vi.fn<() => void>(),
    applyTurnEndAttention: vi.fn<() => void>(),
  }) as unknown as AttentionHelpers

beforeEach(() => {
  useRealRegistryQueries.current = false
  resetSubagentRegistryForTests()
})

describe('maybeFlushBackgroundSubagentResume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateChatMeta.mockResolvedValue(undefined)
    shouldFlushBackgroundSubagentResume.mockReturnValue('noop')
  })

  it('clears pending resume state when flush is clear', () => {
    shouldFlushBackgroundSubagentResume.mockReturnValue('clear')
    const state = buildState()
    const { maybeFlushBackgroundSubagentResume } = createTurnLoop(
      state,
      buildAttention(state),
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
    expect(updateChatMeta).toHaveBeenCalledWith('proj', 'chat-1', { status: 'idle' })
  })

  it('does not clear pending resume when flush is a noop', () => {
    const state = buildState()
    const { maybeFlushBackgroundSubagentResume } = createTurnLoop(
      state,
      buildAttention(state),
      {
        handleEvent: vi.fn<() => void>(),
        persistPermission: vi
          .fn<() => Promise<void>>()
          .mockResolvedValue(undefined),
      },
    )

    maybeFlushBackgroundSubagentResume()

    expect(clearPendingBackgroundResume).not.toHaveBeenCalled()
    expect(updateChatMeta).not.toHaveBeenCalled()
  })

  const lastRunConfig = {
    mode: 'agent' as const,
    model: 'openai::gpt-4o',
    mentions: [],
    effectiveSettings: { version: 1 as const },
  }

  const deliverableResult = {
    toolCallId: 'tc-1',
    result: { subagentId: 'sub-1', name: 'explorer', summary: 'done' },
  }

  const loopDeps = () => ({
    handleEvent: vi.fn<() => void>(),
    persistPermission: vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
  })

  it('does not resume while compacting even when a background result is deliverable', async () => {
    shouldFlushBackgroundSubagentResume.mockImplementation(flushPolicyFromArgs)
    listDeliverableBackgroundResults.mockReturnValue([deliverableResult])
    const state = buildState()
    state.compacting.value = true
    state.lastRunConfig.value = lastRunConfig
    const { maybeFlushBackgroundSubagentResume } = createTurnLoop(
      state,
      buildAttention(state),
      loopDeps(),
    )

    maybeFlushBackgroundSubagentResume()
    await Promise.resolve()

    expect(shouldFlushBackgroundSubagentResume).toHaveBeenCalledWith(
      expect.objectContaining({ parentBusy: true }),
    )
    expect(resumeOrchestrator).not.toHaveBeenCalled()
    expect(state.status.value).toBe('ready')
    expect(state.resumingBackgroundBatch.value).toBe(false)
  })

  it('resumes after compaction completes', async () => {
    shouldFlushBackgroundSubagentResume.mockImplementation(flushPolicyFromArgs)
    listDeliverableBackgroundResults.mockReturnValue([deliverableResult])
    resumeOrchestrator.mockImplementation(async () => {
      listDeliverableBackgroundResults.mockReturnValue([])
    })
    const state = buildState()
    state.compacting.value = true
    state.lastRunConfig.value = lastRunConfig
    createTurnLoop(state, buildAttention(state), loopDeps())

    await nextTick()
    expect(resumeOrchestrator).not.toHaveBeenCalled()

    state.compacting.value = false
    await nextTick()
    await Promise.resolve()

    expect(shouldFlushBackgroundSubagentResume).toHaveBeenCalledWith(
      expect.objectContaining({ parentBusy: false }),
    )
    expect(resumeOrchestrator).toHaveBeenCalled()
  })

  it('resumes on each idle flush when a background result is deliverable', async () => {
    shouldFlushBackgroundSubagentResume.mockImplementation(flushPolicyFromArgs)
    listDeliverableBackgroundResults.mockReturnValue([deliverableResult])
    resumeOrchestrator.mockImplementation(async () => {
      listDeliverableBackgroundResults.mockReturnValue([])
    })
    const state = buildState()
    state.lastRunConfig.value = lastRunConfig
    const { maybeFlushBackgroundSubagentResume } = createTurnLoop(
      state,
      buildAttention(state),
      loopDeps(),
    )

    maybeFlushBackgroundSubagentResume()
    await Promise.resolve()

    expect(shouldFlushBackgroundSubagentResume).toHaveBeenCalledWith(
      expect.objectContaining({ parentBusy: false }),
    )
    expect(resumeOrchestrator).toHaveBeenCalledTimes(1)
    expect(state.resumingBackgroundBatch.value).toBe(true)
  })
})

describe('resumeAfterBackgroundSubagents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resumeOrchestrator.mockResolvedValue(undefined)
    shouldFlushBackgroundSubagentResume.mockReturnValue('noop')
    listDeliverableBackgroundResults.mockReturnValue([
      {
        toolCallId: 'tc-1',
        result: { subagentId: 'sub-1', name: 'explorer', summary: 'done' },
      },
    ])
  })

  it('clears pending resume state when resume throws', async () => {
    resumeOrchestrator.mockRejectedValue(
      new Error('No pending subagent turn to resume'),
    )
    const state = buildState()
    state.lastRunConfig.value = {
      mode: 'agent',
      model: 'openai::gpt-4o',
      mentions: [],
      effectiveSettings: { version: 1 },
    }
    const { resumeAfterBackgroundSubagents } = createTurnLoop(
      state,
      buildAttention(state),
      {
        handleEvent: vi.fn<() => void>(),
        persistPermission: vi
          .fn<() => Promise<void>>()
          .mockResolvedValue(undefined),
      },
    )

    await resumeAfterBackgroundSubagents()

    expect(clearPendingBackgroundResume).toHaveBeenCalledWith('chat-1')
    expect(clearTurnResponseMessages).toHaveBeenCalledWith('chat-1')
    expect(toastError).toHaveBeenCalledWith('Agent resume failed', {
      description: 'No pending subagent turn to resume',
    })
    expect(state.status.value).toBe('error')
    expect(state.resumingBackgroundBatch.value).toBe(false)
  })

  it('does not drain the queue after a successful resume when stop suppression is set', async () => {
    const state = buildState()
    state.suppressQueueDrainAfterStop.value = true
    state.lastRunConfig.value = {
      mode: 'agent',
      model: 'openai::gpt-4o',
      mentions: [],
      effectiveSettings: { version: 1 },
    }
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce(queuedItem)
      .mockReturnValue(undefined)
    const { resumeAfterBackgroundSubagents } = createTurnLoop(
      state,
      buildAttention(state),
      {
        handleEvent: vi.fn<() => void>(),
        persistPermission: vi
          .fn<() => Promise<void>>()
          .mockResolvedValue(undefined),
      },
    )

    await resumeAfterBackgroundSubagents()

    expect(resumeOrchestrator).toHaveBeenCalled()
    expect(state.status.value).toBe('ready')
    expect(state.messageQueue.take).not.toHaveBeenCalled()
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('starts another resume for a late completion before the first resume returns', async () => {
    shouldFlushBackgroundSubagentResume.mockImplementation(flushPolicyFromArgs)
    const resultA = {
      toolCallId: 'tc-1',
      result: { subagentId: 'sub-1', name: 'explorer', summary: 'done' },
    }
    const resultB = {
      toolCallId: 'tc-2',
      result: { subagentId: 'sub-2', name: 'writer', summary: 'late' },
    }
    const waves = [[resultA], [resultB], []]
    listDeliverableBackgroundResults.mockImplementation(() => waves[0] ?? [])
    resumeOrchestrator.mockImplementation(async () => {
      waves.shift()
    })
    const state = buildState()
    state.lastRunConfig.value = {
      mode: 'agent',
      model: 'openai::gpt-4o',
      mentions: [],
      effectiveSettings: { version: 1 },
    }
    const scope = effectScope()
    const turnLoop = scope.run(() =>
      createTurnLoop(state, buildAttention(state), {
        handleEvent: vi.fn<() => void>(),
        persistPermission: vi
          .fn<() => Promise<void>>()
          .mockResolvedValue(undefined),
      }),
    )
    scope.stop()
    if (!turnLoop) {
      throw new Error('Turn loop was not created')
    }

    await turnLoop.resumeAfterBackgroundSubagents()
    await Promise.resolve()
    await Promise.resolve()

    expect(resumeOrchestrator).toHaveBeenCalledTimes(2)
    expect(resumeOrchestrator.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ completedResults: [resultB] }),
    )
  })

  it('keeps pending resume when resume fails while a subagent is still running', async () => {
    useRealRegistryQueries.current = true
    shouldFlushBackgroundSubagentResume.mockImplementation(flushPolicyFromArgs)
    registerSubagent('chat-2', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolveSubagent('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'done',
    })
    registerSubagent('chat-2', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })
    resumeOrchestrator.mockRejectedValue(new Error('stream failed'))
    const state = buildState()
    state.options.chatId = 'chat-2'
    state.lastRunConfig.value = {
      mode: 'agent',
      model: 'openai::gpt-4o',
      mentions: [],
      effectiveSettings: { version: 1 },
    }
    const { resumeAfterBackgroundSubagents } = createTurnLoop(
      state,
      buildAttention(state),
      {
        handleEvent: vi.fn<() => void>(),
        persistPermission: vi
          .fn<() => Promise<void>>()
          .mockResolvedValue(undefined),
      },
    )

    await resumeAfterBackgroundSubagents()
    await nextTick()
    await Promise.resolve()

    expect(hasPendingBackgroundResume('chat-2')).toBe(true)
    expect(clearPendingBackgroundResume).not.toHaveBeenCalled()
    expect(listDeliverableViaRegistry('chat-2')).toEqual([])
    expect(resumeOrchestrator).toHaveBeenCalledTimes(1)
    expect(resumeOrchestrator.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        completedResults: [
          {
            toolCallId: 'tc-1',
            result: {
              subagentId: 'sub-1',
              name: 'explorer',
              summary: 'done',
            },
          },
        ],
      }),
    )

    resolveSubagent('sub-2', {
      subagentId: 'sub-2',
      name: 'writer',
      summary: 'late',
    })
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(resumeOrchestrator).toHaveBeenCalledTimes(2)
    expect(resumeOrchestrator.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        completedResults: [
          {
            toolCallId: 'tc-2',
            result: {
              subagentId: 'sub-2',
              name: 'writer',
              summary: 'late',
            },
          },
        ],
      }),
    )
  })

  it('resumes a deliverable background result when send returns', async () => {
    shouldFlushBackgroundSubagentResume.mockImplementation(flushPolicyFromArgs)
    const delivered = {
      toolCallId: 'tc-1',
      result: { subagentId: 'sub-1', name: 'explorer', summary: 'done' },
    }
    listDeliverableBackgroundResults.mockReturnValue([delivered])
    resumeOrchestrator.mockImplementation(async () => {
      listDeliverableBackgroundResults.mockReturnValue([])
    })
    const state = buildState()
    state.lastRunConfig.value = {
      mode: 'agent',
      model: 'openai::gpt-4o',
      mentions: [],
      effectiveSettings: { version: 1 },
    }
    const { send } = createTurnLoop(state, buildAttention(state), {
      handleEvent: vi.fn<() => void>(),
      persistPermission: vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
    })

    await send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })
    await nextTick()
    await Promise.resolve()

    expect(resumeOrchestrator).toHaveBeenCalledTimes(1)
    expect(resumeOrchestrator.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ completedResults: [delivered] }),
    )
  })
})

describe('idle queue drain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateChatMeta.mockResolvedValue(undefined)
    shouldFlushBackgroundSubagentResume.mockReturnValue('noop')
    sendFn.mockResolvedValue(undefined)
  })

  const loopDeps = () => ({
    handleEvent: vi.fn<() => void>(),
    persistPermission: vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
  })

  it('drains the queue when the parent becomes fully idle after success', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce(queuedItem)
      .mockReturnValue(undefined)
    createTurnLoop(state, buildAttention(state), loopDeps())

    state.status.value = 'ready'
    await nextTick()

    expect(state.messageQueue.take).toHaveBeenCalled()
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'queued',
        internal: true,
        skipUserMessage: undefined,
      }),
    )
  })

  it('replays skipUserMessage when draining a deferred persist', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce({
        ...queuedItem,
        skipUserMessage: true,
      })
      .mockReturnValue(undefined)
    createTurnLoop(state, buildAttention(state), loopDeps())

    state.status.value = 'ready'
    await nextTick()

    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'queued',
        internal: true,
        skipUserMessage: true,
        skipUserPersist: undefined,
      }),
    )
  })

  it('replays appendedUserMessageId when draining a deferred persist', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce({
        ...queuedItem,
        skipUserMessage: true,
        skipUserPersist: true,
        appendedUserMessageId: 'user-msg-1',
      })
      .mockReturnValue(undefined)
    createTurnLoop(state, buildAttention(state), loopDeps())

    state.status.value = 'ready'
    await nextTick()

    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'queued',
        internal: true,
        skipUserMessage: true,
        skipUserPersist: true,
        appendedUserMessageId: 'user-msg-1',
      }),
    )
  })

  it('replays skipUserPersist when draining a deferred retry', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce({
        ...queuedItem,
        skipUserMessage: true,
        skipUserPersist: true,
      })
      .mockReturnValue(undefined)
    createTurnLoop(state, buildAttention(state), loopDeps())

    state.status.value = 'ready'
    await nextTick()

    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'queued',
        internal: true,
        skipUserMessage: true,
        skipUserPersist: true,
      }),
    )
  })

  it('drains the queue when the parent becomes idle after an error', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce(queuedItem)
      .mockReturnValue(undefined)
    createTurnLoop(state, buildAttention(state), loopDeps())

    state.status.value = 'error'
    await nextTick()

    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'queued', internal: true }),
    )
  })

  it('does not drain when compactChat completes after stop', async () => {
    const state = buildState()
    state.suppressQueueDrainAfterStop.value = true
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce(queuedItem)
      .mockReturnValue(undefined)
    const { maybeDrainQueue } = createTurnLoop(
      state,
      buildAttention(state),
      loopDeps(),
    )

    await maybeDrainQueue()

    expect(state.messageQueue.take).not.toHaveBeenCalled()
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('does not drain after an explicit stop', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    state.suppressQueueDrainAfterStop.value = true
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce(queuedItem)
      .mockReturnValue(undefined)
    createTurnLoop(state, buildAttention(state), loopDeps())

    state.status.value = 'ready'
    await nextTick()

    expect(state.messageQueue.take).not.toHaveBeenCalled()
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('keeps queued messages after stop when suppression stays set', async () => {
    const state = buildState()
    state.status.value = 'ready'
    state.suppressQueueDrainAfterStop.value = true
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce(queuedItem)
      .mockReturnValue(undefined)
    createTurnLoop(state, buildAttention(state), loopDeps())

    state.compacting.value = true
    await nextTick()
    state.compacting.value = false
    await nextTick()

    expect(state.messageQueue.take).not.toHaveBeenCalled()
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('drains the queue after a new turn clears stop suppression', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    state.suppressQueueDrainAfterStop.value = true
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce(queuedItem)
      .mockReturnValue(undefined)
    createTurnLoop(state, buildAttention(state), loopDeps())

    state.status.value = 'ready'
    await nextTick()
    expect(sendFn).not.toHaveBeenCalled()

    state.suppressQueueDrainAfterStop.value = false
    await nextTick()

    expect(state.messageQueue.take).toHaveBeenCalled()
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'queued', internal: true }),
    )
  })

  it('flushes a pending background resume before draining the queue', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    const order: string[] = []
    shouldFlushBackgroundSubagentResume.mockImplementation(() => {
      order.push('flush')
      return 'noop'
    })
    vi.mocked(state.messageQueue.take).mockImplementation(() => {
      order.push('take')
      return undefined
    })
    createTurnLoop(state, buildAttention(state), loopDeps())

    state.status.value = 'ready'
    await nextTick()

    expect(order[0]).toBe('flush')
    expect(order).toContain('take')
    expect(order.indexOf('flush')).toBeLessThan(order.indexOf('take'))
  })

  it('does not drain while waiting on background work', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce(queuedItem)
      .mockReturnValue(undefined)
    createTurnLoop(
      state,
      buildAttention(state, {
        isFullyIdle: () => false,
        isParentBusy: () =>
          state.status.value === 'streaming' ||
          state.status.value === 'submitted',
      }),
      loopDeps(),
    )

    state.status.value = 'ready'
    await nextTick()

    expect(shouldFlushBackgroundSubagentResume).toHaveBeenCalled()
    expect(state.messageQueue.take).not.toHaveBeenCalled()
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('drains a queued message when pending resume clears with no running subagents', async () => {
    useRealRegistryQueries.current = true
    registerSubagent('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolveSubagent('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'done',
    })

    const state = buildState()
    state.status.value = 'ready'
    state.subagents.value = [
      {
        subagentId: 'sub-1',
        name: 'explorer',
        blocking: false,
        status: 'done',
        events: [],
      },
    ]
    vi.mocked(state.messageQueue.take)
      .mockReturnValueOnce(queuedItem)
      .mockReturnValue(undefined)
    createTurnLoop(state, createHelpers(state), loopDeps())
    await nextTick()
    expect(sendFn).not.toHaveBeenCalled()

    const subagentsBefore = state.subagents.value
    clearPendingViaRegistry('chat-1')
    expect(state.subagents.value).toBe(subagentsBefore)
    await nextTick()

    expect(state.messageQueue.take).toHaveBeenCalled()
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'queued', internal: true }),
    )
  })
})

