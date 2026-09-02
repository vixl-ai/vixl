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
