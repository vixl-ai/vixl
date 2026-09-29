import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import type { AgentHarnessState, AttentionHelpers } from '@/composables/agent-harness/types'
import type { PendingApproval } from '@/services/harness/permission/approval-gate'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const abortSubagentsForChat = vi.hoisted(() => vi.fn<(chatId: string) => void>())
const abortBlocking = vi.hoisted(() =>
  vi.fn<(chatId: string) => string[]>().mockReturnValue([]),
)
const abortOne = vi.hoisted(() => vi.fn<(subagentId: string) => void>())
const isRunningBackgroundSubagent = vi.hoisted(() =>
  vi.fn<(subagentId: string) => boolean>().mockReturnValue(false),
)
const clearPendingBackgroundResume = vi.hoisted(() =>
  vi.fn<(chatId: string) => void>(),
)
const listSubagentsForChat = vi.hoisted(() =>
  vi
    .fn<(chatId: string) => Array<{ subagentId: string; status: string }>>()
    .mockReturnValue([]),
)
const killShellsForChat = vi.hoisted(() =>
  vi
    .fn<(chatId: string, options?: { keepBackground?: boolean }) => Promise<void>>()
    .mockResolvedValue(undefined),
)
const rejectPendingMcpAuthForChat = vi.hoisted(() =>
  vi.fn<(chatId: string, options?: { keepBackground?: boolean }) => void>(),
)
const rejectPendingMcpAuthForSubagent = vi.hoisted(() =>
  vi.fn<(subagentId: string) => void>(),
)
const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
)

vi.mock('@/services/harness/subagent/registry', () => ({
  abort: (chatId: string) => abortSubagentsForChat(chatId),
  abortBlocking: (chatId: string) => abortBlocking(chatId),
  abortOne: (subagentId: string) => abortOne(subagentId),
  isRunningBackgroundSubagent: (subagentId: string) =>
    isRunningBackgroundSubagent(subagentId),
  clearPendingBackgroundResume: (chatId: string) =>
    clearPendingBackgroundResume(chatId),
  listSubagentsForChat: (chatId: string) => listSubagentsForChat(chatId),
}))

vi.mock('@/services/harness/shell/registry', () => ({
  killShellsForChat: (
    chatId: string,
    options?: { keepBackground?: boolean },
  ) => killShellsForChat(chatId, options),
}))

vi.mock('@/services/mcp/mcp-auth-gate', () => ({
  rejectPendingMcpAuthForChat: (
    chatId: string,
    options?: { keepBackground?: boolean },
  ) => rejectPendingMcpAuthForChat(chatId, options),
  rejectPendingMcpAuthForSubagent: (subagentId: string) =>
    rejectPendingMcpAuthForSubagent(subagentId),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    updateChatMeta: (...args: unknown[]) => updateChatMeta(...args),
  }),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

import createLifecycle from '@/composables/agent-harness/lifecycle'
import {
  getPendingApproval,
  listPendingApprovalsForChat,
  requestApproval,
  resetApprovalGateForTests,
  resolveApproval,
} from '@/services/harness/permission/approval-gate'

const makeGateEntry = (
  overrides: Pick<PendingApproval, 'toolCallId'> &
    Partial<Pick<PendingApproval, 'chatId' | 'subagentId'>>,
): Omit<PendingApproval, 'resolve'> => ({
  chatId: 'chat-1',
  name: 'write_file',
  kind: 'fs',
  action: 'fs.write',
  capability: 'fs.write:a.txt',
  title: 'Write file',
  allowedScopes: ['once', 'session', 'always'],
  ...overrides,
})

const makeApprovalView = (
  toolCallId: string,
  subagentId?: string,
): PendingApprovalView => ({
  toolCallId,
  name: 'write_file',
  kind: 'fs',
  title: 'Write file',
  allowedScopes: ['once', 'session', 'always'],
  subagentId,
})

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
      completeLocalSubagent: vi.fn<(...args: unknown[]) => void>(),
      clearLocalQueuedSubagentSteers: vi.fn<(id: string) => void>(),
      finishAgentTurn: vi.fn<() => void>(),
      patchMeta: vi.fn<(patch: unknown) => void>(),
    },
    status: ref('streaming'),
    subagents: shallowRef([
      {
        subagentId: 'run-1',
        name: 'explorer',
        blocking: false,
        status: 'running',
        events: [],
      },
    ]),
    abortController: ref(new AbortController()),
    pendingApprovals: shallowRef<PendingApprovalView[]>([]),
    pendingMcpAuth: shallowRef([]),
    messageQueue: {
      items: ref([]),
      remove: vi.fn<(id: string) => void>(),
      clear: vi.fn<() => void>(),
    },
    suppressQueueDrainAfterStop: ref(false),
    compacting: ref(false),
    resumingBackgroundBatch: ref(false),
    disposed: ref(false),
  }) as unknown as AgentHarnessState

const buildAttention = (): AttentionHelpers =>
  ({
    refreshSidebar: vi.fn<() => void>(),
    maybeClearAttentionWhenGatesEmpty: vi.fn<() => void>(),
  }) as unknown as AttentionHelpers

const buildDeps = () => ({
  send: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
  stopMcpAuthPolling: vi.fn<() => void>(),
  syncPendingMcpAuth: vi.fn<() => void>(),
  maybeFlushBackgroundSubagentResume: vi.fn<() => void>(),
})

describe('agent-harness lifecycle stop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetApprovalGateForTests()
    updateChatMeta.mockResolvedValue(undefined)
    killShellsForChat.mockResolvedValue(undefined)
    listSubagentsForChat.mockReturnValue([])
    abortBlocking.mockReturnValue([])
    isRunningBackgroundSubagent.mockReturnValue(false)
  })

  it('suppresses queue drain and still aborts running subagents', async () => {
    const state = buildState()
    const { stop } = createLifecycle(state, buildAttention(), buildDeps())

    await stop()

    expect(state.suppressQueueDrainAfterStop.value).toBe(true)
    expect(abortSubagentsForChat).toHaveBeenCalledWith('chat-1')
    expect(killShellsForChat).toHaveBeenCalledWith('chat-1', undefined)
    expect(rejectPendingMcpAuthForChat).toHaveBeenCalledWith('chat-1', undefined)
    expect(state.session.clearLocalQueuedSubagentSteers).toHaveBeenCalledWith(
      'run-1',
    )
    expect(state.subagents.value[0]?.status).toBe('stopped')
    expect(state.status.value).toBe('ready')
  })

  it('finalizes a steered-and-resumed subagent missing from the live list', async () => {
    const state = buildState()
    state.subagents.value = []
    listSubagentsForChat.mockReturnValue([
      { subagentId: 'steered-1', status: 'running' },
    ])
    const { stop } = createLifecycle(state, buildAttention(), buildDeps())

    await stop()

    expect(listSubagentsForChat).toHaveBeenCalledWith('chat-1')
    expect(abortSubagentsForChat).toHaveBeenCalledWith('chat-1')
    expect(state.session.clearLocalQueuedSubagentSteers).toHaveBeenCalledWith(
      'steered-1',
    )
    expect(state.session.completeLocalSubagent).toHaveBeenCalledWith(
      'steered-1',
      'Stopped',
      'stopped',
    )
  })

  it('clears undelivered pending steers when stopping one subagent', () => {
    const state = buildState()
    const deps = buildDeps()
    const { stopSubagent } = createLifecycle(state, buildAttention(), deps)

    stopSubagent('run-1')

    expect(abortOne).toHaveBeenCalledWith('run-1')
    expect(state.session.clearLocalQueuedSubagentSteers).toHaveBeenCalledWith(
      'run-1',
    )
    expect(state.session.completeLocalSubagent).toHaveBeenCalledWith(
      'run-1',
      'Stopped',
      'stopped',
    )
    expect(state.subagents.value[0]?.status).toBe('stopped')
    expect(deps.maybeFlushBackgroundSubagentResume).toHaveBeenCalled()
  })

  it('drops that subagent approval card and denies its gate', async () => {
    const state = buildState()
    state.pendingApprovals.value = [
      makeApprovalView('tool-target', 'run-1'),
      makeApprovalView('tool-other', 'run-2'),
      makeApprovalView('tool-parent'),
    ]
    const target = requestApproval(
      makeGateEntry({ toolCallId: 'tool-target', subagentId: 'run-1' }),
    )
    const otherSubagent = requestApproval(
      makeGateEntry({ toolCallId: 'tool-other', subagentId: 'run-2' }),
    )
    const parent = requestApproval(makeGateEntry({ toolCallId: 'tool-parent' }))
    const attention = buildAttention()
    const deps = buildDeps()
    const { stopSubagent } = createLifecycle(state, attention, deps)

    stopSubagent('run-1')

    expect(state.pendingApprovals.value.map((entry) => entry.toolCallId)).toEqual([
      'tool-other',
      'tool-parent',
    ])
    await expect(target).resolves.toEqual({ approved: false, scope: 'once' })
    expect(getPendingApproval('tool-target')).toBeUndefined()
    expect(getPendingApproval('tool-other')).toBeDefined()
    expect(getPendingApproval('tool-parent')).toBeDefined()
    expect(listPendingApprovalsForChat('chat-1')).toHaveLength(2)
    expect(rejectPendingMcpAuthForSubagent).toHaveBeenCalledWith('run-1')
    expect(deps.syncPendingMcpAuth).toHaveBeenCalled()
    expect(attention.maybeClearAttentionWhenGatesEmpty).toHaveBeenCalled()

    resolveApproval('tool-other', { approved: true, scope: 'once' })
    await expect(otherSubagent).resolves.toEqual({ approved: true, scope: 'once' })
    resolveApproval('tool-parent', { approved: true, scope: 'once' })
    await expect(parent).resolves.toEqual({ approved: true, scope: 'once' })
  })

  it('clears pending approval cards on full stop', async () => {
    const state = buildState()
    state.pendingApprovals.value = [
      makeApprovalView('tool-parent'),
      makeApprovalView('tool-sa', 'run-1'),
    ]
    const parent = requestApproval(makeGateEntry({ toolCallId: 'tool-parent' }))
    const subagent = requestApproval(
      makeGateEntry({ toolCallId: 'tool-sa', subagentId: 'run-1' }),
    )
    const attention = buildAttention()
    const { stop } = createLifecycle(state, attention, buildDeps())

    await stop()

    expect(state.pendingApprovals.value).toEqual([])
    expect(state.pendingMcpAuth.value).toEqual([])
    expect(attention.maybeClearAttentionWhenGatesEmpty).toHaveBeenCalled()
    await expect(parent).resolves.toEqual({ approved: false, scope: 'once' })
    await expect(subagent).resolves.toEqual({ approved: false, scope: 'once' })
    expect(getPendingApproval('tool-parent')).toBeUndefined()
    expect(getPendingApproval('tool-sa')).toBeUndefined()
  })

  it('keeps queued messages and drain suppression after stop', async () => {
    const state = buildState()
    state.messageQueue.items.value = [
      {
        id: 'q-1',
        text: 'queued',
        files: [],
        mode: 'agent',
        model: 'openai::gpt-4o',
      },
    ]
    const { stop } = createLifecycle(state, buildAttention(), buildDeps())

    await stop()

    expect(state.suppressQueueDrainAfterStop.value).toBe(true)
    expect(state.messageQueue.items.value).toHaveLength(1)
    expect(state.messageQueue.clear).not.toHaveBeenCalled()

    state.compacting.value = true
    await nextTick()
    state.compacting.value = false
    await nextTick()

    expect(state.suppressQueueDrainAfterStop.value).toBe(true)
    expect(state.messageQueue.items.value).toHaveLength(1)
  })

  it('leaves stop-queue suppression set when force-send does not start a turn', async () => {
    const state = buildState()
    state.messageQueue.items.value = [
      {
        id: 'q-1',
        text: 'queued',
        files: [],
        mode: 'agent',
        model: 'openai::gpt-4o',
      },
    ]
    const deps = buildDeps()
    const { forceSendQueued } = createLifecycle(state, buildAttention(), deps)

    await forceSendQueued('q-1')

    expect(state.suppressQueueDrainAfterStop.value).toBe(true)
    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'queued',
        internal: true,
        skipUserMessage: undefined,
        skipUserPersist: undefined,
      }),
    )
  })

  it('force-sends skipUserMessage from a deferred queued item', async () => {
    const state = buildState()
    state.messageQueue.items.value = [
      {
        id: 'q-1',
        text: 'queued',
        files: [],
        mode: 'agent',
        model: 'openai::gpt-4o',
        skipUserMessage: true,
        skipUserPersist: true,
      },
    ]
    const deps = buildDeps()
    const { forceSendQueued } = createLifecycle(state, buildAttention(), deps)

    await forceSendQueued('q-1')

    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'queued',
        internal: true,
        skipUserMessage: true,
        skipUserPersist: true,
      }),
    )
  })

  it('waits for compaction to finish before force-sending', async () => {
    const state = buildState()
    state.compacting.value = true
    state.messageQueue.items.value = [
      {
        id: 'q-1',
        text: 'queued',
        files: [],
        mode: 'agent',
        model: 'openai::gpt-4o',
      },
    ]
    const deps = buildDeps()
    const { forceSendQueued } = createLifecycle(state, buildAttention(), deps)

    const pending = forceSendQueued('q-1')
    await nextTick()

    expect(deps.send).not.toHaveBeenCalled()

    state.compacting.value = false
    await nextTick()
    await pending

    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'queued',
        internal: true,
      }),
    )
  })

  it('force-sends without aborting background subagents or clearing resume', async () => {
    const state = buildState()
    state.subagents.value = [
      {
        subagentId: 'bg-1',
        name: 'explorer',
        blocking: false,
        status: 'running',
        events: [],
      },
      {
        subagentId: 'block-1',
        name: 'reviewer',
        blocking: true,
        status: 'running',
        events: [],
      },
    ]
    abortBlocking.mockReturnValue(['block-1'])
    state.messageQueue.items.value = [
      {
        id: 'q-1',
        text: 'queued',
        files: [],
        mode: 'agent',
        model: 'openai::gpt-4o',
      },
    ]
    const deps = buildDeps()
    const { forceSendQueued } = createLifecycle(state, buildAttention(), deps)

    await forceSendQueued('q-1')

    expect(abortBlocking).toHaveBeenCalledWith('chat-1')
    expect(abortSubagentsForChat).not.toHaveBeenCalled()
    expect(clearPendingBackgroundResume).not.toHaveBeenCalled()
    expect(state.session.completeLocalSubagent).toHaveBeenCalledWith(
      'block-1',
      'Stopped',
      'stopped',
    )
    expect(state.session.completeLocalSubagent).not.toHaveBeenCalledWith(
      'bg-1',
      'Stopped',
      'stopped',
    )
    expect(state.subagents.value.find((item) => item.subagentId === 'bg-1')?.status).toBe(
      'running',
    )
    expect(
      state.subagents.value.find((item) => item.subagentId === 'block-1')?.status,
    ).toBe('stopped')
    expect(deps.send).toHaveBeenCalled()
    expect(killShellsForChat).toHaveBeenCalledWith('chat-1', {
      keepBackground: true,
    })
    expect(rejectPendingMcpAuthForChat).toHaveBeenCalledWith('chat-1', {
      keepBackground: true,
    })
  })

  it('force-sends without rejecting running background approvals', async () => {
    isRunningBackgroundSubagent.mockImplementation(
      (subagentId) => subagentId === 'bg-1',
    )
    const state = buildState()
    state.pendingApprovals.value = [
      makeApprovalView('tool-parent'),
      makeApprovalView('tool-bg', 'bg-1'),
      makeApprovalView('tool-block', 'block-1'),
    ]
    const parent = requestApproval(makeGateEntry({ toolCallId: 'tool-parent' }))
    const background = requestApproval(
      makeGateEntry({ toolCallId: 'tool-bg', subagentId: 'bg-1' }),
    )
    const blocking = requestApproval(
      makeGateEntry({ toolCallId: 'tool-block', subagentId: 'block-1' }),
    )
    state.messageQueue.items.value = [
      {
        id: 'q-1',
        text: 'queued',
        files: [],
        mode: 'agent',
        model: 'openai::gpt-4o',
      },
    ]
    const deps = buildDeps()
    const { forceSendQueued } = createLifecycle(state, buildAttention(), deps)

    await forceSendQueued('q-1')

    await expect(parent).resolves.toEqual({ approved: false, scope: 'once' })
    await expect(blocking).resolves.toEqual({ approved: false, scope: 'once' })
    expect(getPendingApproval('tool-bg')).toBeDefined()
    expect(state.pendingApprovals.value.map((entry) => entry.toolCallId)).toEqual([
      'tool-bg',
    ])
    expect(deps.syncPendingMcpAuth).toHaveBeenCalled()
    expect(deps.stopMcpAuthPolling).not.toHaveBeenCalled()
    resolveApproval('tool-bg', { approved: true, scope: 'once' })
    await expect(background).resolves.toEqual({ approved: true, scope: 'once' })
  })

  it('does not force-send after dispose while waiting on compaction', async () => {
    const state = buildState()
    state.compacting.value = true
    state.messageQueue.items.value = [
      {
        id: 'q-1',
        text: 'queued',
        files: [],
        mode: 'agent',
        model: 'openai::gpt-4o',
      },
    ]
    const deps = buildDeps()
    const { forceSendQueued } = createLifecycle(state, buildAttention(), deps)

    const pending = forceSendQueued('q-1')
    await nextTick()
    state.disposed.value = true
    await nextTick()
    await pending

    expect(deps.send).not.toHaveBeenCalled()
  })
})
