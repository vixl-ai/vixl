import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { AgentHarnessState, AttentionHelpers } from '@/composables/agent-harness/types'

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
