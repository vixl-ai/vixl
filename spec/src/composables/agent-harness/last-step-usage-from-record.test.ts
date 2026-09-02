import { describe, expect, it } from 'vitest'
import lastStepUsageFromRecord from '@/composables/agent-harness/last-step-usage-from-record'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'

const record = (
  patch: Partial<BillableUsageRecord> & Pick<BillableUsageRecord, 'source'>,
): BillableUsageRecord => ({
  id: 'row-1',
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

describe('lastStepUsageFromRecord', () => {
  it('maps a main row with tokens onto LastStepUsage', () => {
    expect(lastStepUsageFromRecord(record({ source: 'main' }))).toEqual({
      promptTokens: 40,
      inputTokens: 40,
      outputTokens: 8,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
    })
  })

  it('skips subagent rows', () => {
    expect(
      lastStepUsageFromRecord(
        record({ source: 'subagent', subagentId: 'sub-1' }),
      ),
    ).toBeNull()
  })

  it('skips main rows without token fields', () => {
    expect(
      lastStepUsageFromRecord(
        record({ source: 'main', usage: {} }),
      ),
    ).toBeNull()
  })
})
