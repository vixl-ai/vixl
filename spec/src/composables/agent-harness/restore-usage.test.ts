import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { AgentHarnessState } from '@/composables/agent-harness/types'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { TurnUsageAggregate } from '@/types/billing/turn-usage-aggregate'

const readUsageLedger = vi.hoisted(() =>
  vi.fn<(projectSlug: string, chatId: string) => Promise<BillableUsageRecord[]>>(),
)
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('@/services/billing/read-usage-ledger', () => ({
  default: (...args: [string, string]) => readUsageLedger(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import createRestoreUsage from '@/composables/agent-harness/restore-usage'

const record = (
  patch: Partial<BillableUsageRecord> &
    Pick<BillableUsageRecord, 'id' | 'turnId' | 'source' | 'at'>,
): BillableUsageRecord => ({
  chatId: 'chat-1',
  providerId: 'openai',
  modelId: 'gpt-4o',
  costUSD: 0.01,
  pricingSource: 'user_configured',
  usage: {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 4,
    cacheWriteTokens: 2,
  },
  ...patch,
})

const buildState = (overrides?: {
  status?: 'ready' | 'streaming'
  sessionActive?: boolean
}): AgentHarnessState => {
  const setLastStepUsage = vi.fn<(usage: unknown) => void>()
  return {
    options: {
      projectSlug: 'proj',
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
    },
    billableUsageRecords: shallowRef<BillableUsageRecord[]>([]),
    turnUsageByTurnId: shallowRef<Record<string, TurnUsageAggregate>>({}),
    status: ref(overrides?.status ?? 'ready'),
    contextUsage: {
      lastStepUsage: ref(null),
      setLastStepUsage,
    },
    chatStore: {
      isSessionActive: () => overrides?.sessionActive ?? true,
    },
  } as unknown as AgentHarnessState
}

describe('restoreUsageLedger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps ledger rows onto two turns and uses the latest main row for last-step', async () => {
    readUsageLedger.mockResolvedValue([
      record({
        id: 'row-1',
        turnId: 'turn-a',
        source: 'main',
        at: '2026-01-01T00:00:00.000Z',
        usage: {
          inputTokens: 10,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
      record({
        id: 'row-2',
        turnId: 'turn-a',
        source: 'subagent',
        subagentId: 'sub-1',
        at: '2026-01-01T00:01:00.000Z',
        usage: {
          inputTokens: 5,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
      record({
        id: 'row-3',
        turnId: 'turn-b',
        source: 'main',
        at: '2026-01-01T00:02:00.000Z',
        usage: {
          inputTokens: 40,
          outputTokens: 8,
          cacheReadTokens: 3,
          cacheWriteTokens: 1,
        },
      }),
    ])

    const state = buildState()
    const { restoreUsageLedger } = createRestoreUsage(state)
    await restoreUsageLedger()

    expect(readUsageLedger).toHaveBeenCalledWith('proj', 'chat-1')
    expect(state.billableUsageRecords.value).toHaveLength(3)

    const turnA = state.turnUsageByTurnId.value['turn-a']
    const turnB = state.turnUsageByTurnId.value['turn-b']
    expect(turnA?.inputTokens).toBe(15)
    expect(turnA?.outputTokens).toBe(3)
    expect(turnA?.parts).toHaveLength(2)
    expect(turnB?.inputTokens).toBe(40)
    expect(turnB?.outputTokens).toBe(8)
    expect(turnB?.cacheReadTokens).toBe(3)
    expect(turnB?.cacheWriteTokens).toBe(1)

    expect(state.contextUsage.setLastStepUsage).toHaveBeenCalledTimes(1)
    expect(state.contextUsage.setLastStepUsage).toHaveBeenCalledWith({
      promptTokens: 40,
      inputTokens: 40,
      outputTokens: 8,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
    })
  })

  it('skips last-step when only subagent rows have tokens', async () => {
    readUsageLedger.mockResolvedValue([
      record({
        id: 'row-sub',
        turnId: 'turn-a',
        source: 'subagent',
        subagentId: 'sub-1',
        at: '2026-01-01T00:01:00.000Z',
      }),
    ])

    const state = buildState()
    const { restoreUsageLedger } = createRestoreUsage(state)
    await restoreUsageLedger()

    expect(state.turnUsageByTurnId.value['turn-a']?.inputTokens).toBe(100)
    expect(state.contextUsage.setLastStepUsage).not.toHaveBeenCalled()
  })

  it('skips last-step when the session is not active', async () => {
    readUsageLedger.mockResolvedValue([
      record({
        id: 'row-1',
        turnId: 'turn-a',
        source: 'main',
        at: '2026-01-01T00:00:00.000Z',
      }),
    ])

    const state = buildState({ sessionActive: false })
    const { restoreUsageLedger } = createRestoreUsage(state)
    await restoreUsageLedger()

    expect(state.turnUsageByTurnId.value['turn-a']?.inputTokens).toBe(100)
    expect(state.contextUsage.setLastStepUsage).not.toHaveBeenCalled()
  })

  it('toasts when the ledger read fails', async () => {
    readUsageLedger.mockRejectedValue(new Error('sqlite locked'))
    const state = buildState()
    const { restoreUsageLedger } = createRestoreUsage(state)
    await restoreUsageLedger()

    expect(toastError).toHaveBeenCalledWith('Failed to restore usage', {
      description: 'sqlite locked',
    })
    expect(state.billableUsageRecords.value).toEqual([])
  })
})
