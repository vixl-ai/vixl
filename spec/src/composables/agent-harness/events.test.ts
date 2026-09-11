import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { AgentHarnessState, AttentionHelpers } from '@/composables/agent-harness/types'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn<(...args: unknown[]) => void>(), success: vi.fn<(...args: unknown[]) => void>() },
}))

vi.mock('@/services/harness/orchestrator', () => ({
  mapMetaStatusToChatStatus: (status: string) => status,
}))

const routerReplace = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/router', () => ({
  default: {
    replace: (...args: unknown[]) => routerReplace(...args),
  },
}))

const rekeyAgentHarness = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('@/composables/agent-harness/cache', () => ({
  rekeyAgentHarness: (...args: unknown[]) => rekeyAgentHarness(...args),
}))

vi.mock('@/services/harness/plan-execution-session', () => ({
  rekeyPlanExecutionSession: vi.fn<(...args: unknown[]) => void>(),
}))

import { toast } from 'vue-sonner'
import createEvents from '@/composables/agent-harness/events'

const buildState = (): AgentHarnessState =>
  ({
    options: { projectSlug: 'proj', chatId: 'chat-1' },
    session: {
      upsertLocalToolRun: vi.fn<(...args: unknown[]) => void>(),
      appendLocalTextDelta: vi.fn<(...args: unknown[]) => void>(),
      appendLocalReasoningDelta: vi.fn<(...args: unknown[]) => void>(),
      appendLocalTodoUpdate: vi.fn<(...args: unknown[]) => void>(),
      upsertLocalSubagentStart: vi.fn<(...args: unknown[]) => void>(),
      appendLocalSubagentToolEvent: vi.fn<(...args: unknown[]) => void>(),
      setLocalSubagentPrompt: vi.fn<(...args: unknown[]) => void>(),
      completeLocalSubagent: vi.fn<(...args: unknown[]) => void>(),
      setPendingQuestion: vi.fn<(...args: unknown[]) => void>(),
      startAgentStep: vi.fn<(...args: unknown[]) => void>(),
      finishAgentStep: vi.fn<(...args: unknown[]) => void>(),
      patchMeta: vi.fn<(...args: unknown[]) => void>(),
      appendLocalCompaction: vi.fn<(...args: unknown[]) => void>(),
      clearPendingQuestion: vi.fn<(...args: unknown[]) => void>(),
      finishAgentTurn: vi.fn<(...args: unknown[]) => void>(),
    },
    status: ref('ready'),
    toolRuns: shallowRef([]),
    subagents: shallowRef([]),
    liveEvents: ref([]),
    pendingApprovals: shallowRef([]),
    billableUsageRecords: shallowRef([]),
    turnUsageByTurnId: shallowRef({}),
    contextUsage: {
      setBudget: vi.fn<(...args: unknown[]) => void>(),
      setLastStepUsage: vi.fn<(...args: unknown[]) => void>(),
      clearLastStepUsage: vi.fn<(...args: unknown[]) => void>(),
    },
    contextBudgetSync: {
      refreshContextBudget: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    },
    compacting: ref(false),
    disposed: ref(false),
    chatStore: {
      isSessionActive: vi.fn<() => boolean>().mockReturnValue(true),
    },
  }) as unknown as AgentHarnessState

const buildAttention = (): AttentionHelpers =>
  ({
    refreshSidebar: vi.fn<(...args: unknown[]) => void>(),
    setChatAttention: vi.fn<(...args: unknown[]) => void>(),
    maybeClearAttentionWhenGatesEmpty: vi.fn<(...args: unknown[]) => void>(),
    applyTurnEndAttention: vi.fn<(...args: unknown[]) => void>(),
    isParentBusy: () => false,
    isWaitingOnBackground: () => false,
    isFullyIdle: () => true,
  }) as unknown as AttentionHelpers

const deps = {
  startMcpAuthPolling: vi.fn<() => void>(),
  syncPendingMcpAuth: vi.fn<() => void>(),
  maybeFlushBackgroundSubagentResume: vi.fn<() => void>(),
}

describe('agent-harness events partial tool path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('holds write_file until a path is known', () => {
    const state = buildState()
    const { handleEvent } = createEvents(state, buildAttention(), deps)

    handleEvent({
      type: 'tool-input-start',
      toolCallId: 'call-1',
      name: 'write_file',
    })

    expect(state.toolRuns.value).toEqual([])
    expect(state.session.upsertLocalToolRun).not.toHaveBeenCalled()
    expect(state.status.value).toBe('streaming')
  })

  it('upserts write_file once a path arrives and keeps that path', () => {
    const state = buildState()
    const { handleEvent } = createEvents(state, buildAttention(), deps)

    handleEvent({
      type: 'tool-input-start',
      toolCallId: 'call-1',
      name: 'edit_file',
    })
    handleEvent({
      type: 'tool-input-delta',
      toolCallId: 'call-1',
      name: 'edit_file',
      args: { path: 'src/a.ts' },
    })
    handleEvent({
      type: 'tool-start',
      toolCallId: 'call-1',
      name: 'edit_file',
      args: { content: 'hello' },
    })

    expect(state.toolRuns.value).toEqual([
      {
        toolCallId: 'call-1',
        name: 'edit_file',
        status: 'running',
        args: { path: 'src/a.ts', content: 'hello' },
      },
    ])
    expect(state.session.upsertLocalToolRun).toHaveBeenCalledTimes(2)
  })

  it('still shows other tools on tool-input-start', () => {
    const state = buildState()
    const { handleEvent } = createEvents(state, buildAttention(), deps)

    handleEvent({
      type: 'tool-input-start',
      toolCallId: 'call-2',
      name: 'read_file',
    })

    expect(state.toolRuns.value).toEqual([
      {
        toolCallId: 'call-2',
        name: 'read_file',
        status: 'running',
        args: undefined,
      },
    ])
    expect(state.session.upsertLocalToolRun).toHaveBeenCalledTimes(1)
  })
})

const billableRecord = (
  patch: Partial<BillableUsageRecord> & Pick<BillableUsageRecord, 'id' | 'source'>,
): BillableUsageRecord => ({
  chatId: 'chat-1',
  turnId: 'turn-a',
  at: '2026-01-01T00:00:00.000Z',
  providerId: 'openai',
  modelId: 'gpt-4o',
  costUSD: 0.01,
  pricingSource: 'user_configured',
  usage: {
    inputTokens: 40,
    outputTokens: 8,
    cacheReadTokens: 3,
    cacheWriteTokens: 1,
  },
  ...patch,
})

describe('agent-harness events billable-usage last-step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets last-step from a main billable-usage row', () => {
    const state = buildState()
    const { handleEvent } = createEvents(state, buildAttention(), deps)

    handleEvent({
      type: 'billable-usage',
      record: billableRecord({ id: 'row-1', source: 'main' }),
    })

    expect(state.contextUsage.setLastStepUsage).toHaveBeenCalledTimes(1)
    expect(state.contextUsage.setLastStepUsage).toHaveBeenCalledWith({
      promptTokens: 40,
      inputTokens: 40,
      outputTokens: 8,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
    })
  })

  it('does not set last-step from a subagent billable-usage row', () => {
    const state = buildState()
    const { handleEvent } = createEvents(state, buildAttention(), deps)

    handleEvent({
      type: 'billable-usage',
      record: billableRecord({
        id: 'row-sub',
        source: 'subagent',
        subagentId: 'sub-1',
      }),
    })

    expect(state.billableUsageRecords.value).toHaveLength(1)
    expect(state.contextUsage.setLastStepUsage).not.toHaveBeenCalled()
  })

  it('applies last-step again when the same main row is re-emitted', () => {
    const state = buildState()
    const { handleEvent } = createEvents(state, buildAttention(), deps)
    const first = billableRecord({ id: 'row-1', source: 'main' })
    const enriched = billableRecord({
      id: 'row-1',
      source: 'main',
      costUSD: 0.02,
      usage: {
        inputTokens: 41,
        outputTokens: 8,
        cacheReadTokens: 3,
        cacheWriteTokens: 1,
      },
    })

    handleEvent({ type: 'billable-usage', record: first })
    handleEvent({ type: 'billable-usage', record: enriched })

    expect(state.billableUsageRecords.value).toHaveLength(1)
    expect(state.contextUsage.setLastStepUsage).toHaveBeenCalledTimes(2)
    expect(state.contextUsage.setLastStepUsage).toHaveBeenLastCalledWith({
      promptTokens: 41,
      inputTokens: 41,
      outputTokens: 8,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
    })
  })

  it('does not clear last-step when applying a context-budget event', () => {
    const state = buildState()
    const { handleEvent } = createEvents(state, buildAttention(), deps)

    handleEvent({
      type: 'context-budget',
      modelId: 'gpt-4o',
      used: 100,
      promptUsed: 100,
      limit: 128_000,
      reservedOutput: 8_192,
      safetyBuffer: 2_000,
      free: 117_708,
      buckets: [],
    })

    expect(state.contextUsage.setBudget).toHaveBeenCalledTimes(1)
    expect(state.contextUsage.setBudget).toHaveBeenCalledWith({
      modelId: 'gpt-4o',
      used: 100,
      promptUsed: 100,
      limit: 128_000,
      reservedOutput: 8_192,
      safetyBuffer: 2_000,
      free: 117_708,
      buckets: [],
    })
    expect(state.contextUsage.clearLastStepUsage).not.toHaveBeenCalled()
  })
})

describe('agent-harness events workspace-moved', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets standalone false and activates the destination project', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const setActiveProject = vi
      .fn<(id: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const refreshSlug = vi
      .fn<(slug: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const rekeySession = vi.fn<(...args: unknown[]) => void>()
    const loadedThreadKey = ref<string | null>('_home_:chat-1')

    const state = {
      ...buildState(),
      options: {
        projectSlug: '_home_',
        chatId: 'chat-1',
        projectRoot: '/home',
        projectName: 'Home',
        standalone: true,
        loadedThreadKey,
      },
      fleet: {
        refresh,
        setActiveProject,
      },
      fleetSidebar: {
        refreshSlug,
      },
      chatStore: {
        rekeySession,
      },
    } as unknown as AgentHarnessState

    const { handleEvent } = createEvents(state, buildAttention(), deps)

    await handleEvent({
      type: 'workspace-moved',
      fromProjectSlug: '_home_',
      chatId: 'chat-1',
      project: {
        id: 'proj-1',
        name: 'Dest',
        slug: 'dest',
        rootPath: '/tmp/dest',
      },
      projectSlug: 'dest',
      projectRoot: '/tmp/dest',
    })

    expect(state.options.standalone).toBe(false)
    expect(state.options.projectSlug).toBe('dest')
    expect(state.options.projectRoot).toBe('/tmp/dest')
    expect(state.options.projectName).toBe('Dest')
    expect(loadedThreadKey.value).toBe('dest:chat-1')
    expect(rekeySession).toHaveBeenCalledWith('_home_', 'chat-1', {
      projectSlug: 'dest',
      projectRoot: '/tmp/dest',
    })
    expect(rekeyAgentHarness).toHaveBeenCalledWith('_home_', 'chat-1', 'dest')
    expect(setActiveProject).toHaveBeenCalledWith('proj-1')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(routerReplace).toHaveBeenCalledWith('/project/dest/chat/chat-1')
    expect(refreshSlug).toHaveBeenCalledWith('_home_')
    expect(refreshSlug).toHaveBeenCalledWith('dest')
  })

  it('rekeys sync then toasts and rejects when fleet activation fails', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const setActiveProject = vi
      .fn<(id: string) => Promise<void>>()
      .mockRejectedValue(new Error('no graph'))
    const refreshSlug = vi
      .fn<(slug: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const rekeySession = vi.fn<(...args: unknown[]) => void>()

    const state = {
      ...buildState(),
      options: {
        projectSlug: '_home_',
        chatId: 'chat-1',
        projectRoot: '/home',
        projectName: 'Home',
        standalone: true,
      },
      fleet: {
        refresh,
        setActiveProject,
      },
      fleetSidebar: {
        refreshSlug,
      },
      chatStore: {
        rekeySession,
      },
    } as unknown as AgentHarnessState

    const { handleEvent } = createEvents(state, buildAttention(), deps)

    await expect(
      handleEvent({
        type: 'workspace-moved',
        fromProjectSlug: '_home_',
        chatId: 'chat-1',
        project: {
          id: 'proj-1',
          name: 'Dest',
          slug: 'dest',
          rootPath: '/tmp/dest',
        },
        projectSlug: 'dest',
        projectRoot: '/tmp/dest',
      }),
    ).rejects.toThrow('no graph')

    expect(state.options.projectSlug).toBe('dest')
    expect(rekeySession).toHaveBeenCalled()
    expect(rekeyAgentHarness).toHaveBeenCalledWith('_home_', 'chat-1', 'dest')
    expect(toast.error).toHaveBeenCalledWith('Failed to rebind workspace', {
      description: 'no graph',
    })
    expect(refreshSlug).not.toHaveBeenCalled()
  })
})

describe('agent-harness events visible context gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const fireVisibleContextEvents = (state: AgentHarnessState): void => {
    const { handleEvent } = createEvents(state, buildAttention(), deps)

    handleEvent({
      type: 'context-budget',
      modelId: 'gpt-4o',
      used: 999,
      promptUsed: 999,
      limit: 128_000,
      reservedOutput: 8_192,
      safetyBuffer: 2_000,
      free: 0,
      buckets: [],
    })
    handleEvent({
      type: 'context-usage',
      modelId: 'gpt-4o',
      promptTokens: 50,
      inputTokens: 50,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    handleEvent({
      type: 'billable-usage',
      record: billableRecord({ id: 'row-bg', source: 'main' }),
    })
    handleEvent({
      type: 'compaction',
      summary: 'recap',
      focus: null,
    })
  }

  it('does not let an inactive harness overwrite visible context', () => {
    const state = buildState()
    vi.mocked(state.chatStore.isSessionActive).mockReturnValue(false)

    fireVisibleContextEvents(state)

    expect(state.billableUsageRecords.value).toHaveLength(1)
    expect(state.session.appendLocalCompaction).toHaveBeenCalledWith('recap', null)
    expect(state.compacting.value).toBe(false)
    expect(state.contextUsage.setBudget).not.toHaveBeenCalled()
    expect(state.contextUsage.setLastStepUsage).not.toHaveBeenCalled()
    expect(state.contextUsage.clearLastStepUsage).not.toHaveBeenCalled()
    expect(state.contextBudgetSync.refreshContextBudget).not.toHaveBeenCalled()
  })

  it('does not let a disposed harness write visible context', () => {
    const state = buildState()
    state.disposed.value = true

    fireVisibleContextEvents(state)

    expect(state.billableUsageRecords.value).toHaveLength(1)
    expect(state.session.appendLocalCompaction).toHaveBeenCalledWith('recap', null)
    expect(state.contextUsage.setBudget).not.toHaveBeenCalled()
    expect(state.contextUsage.setLastStepUsage).not.toHaveBeenCalled()
    expect(state.contextUsage.clearLastStepUsage).not.toHaveBeenCalled()
    expect(state.contextBudgetSync.refreshContextBudget).not.toHaveBeenCalled()
  })
})
