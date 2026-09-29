import { describe, expect, it } from 'vitest'
import type { SubagentRecord } from '@/types/harness/subagent-record'
import appendSubagentCheckpointSummary from '@/services/harness/orchestrator/append-subagent-checkpoint-summary'
import buildSubagentLedger from '@/services/harness/orchestrator/build-subagent-ledger'

const record = (
  overrides: Pick<SubagentRecord, 'agentName' | 'subagentId' | 'status'> &
    Partial<SubagentRecord>,
): SubagentRecord => ({
  chatId: 'chat-1',
  toolCallId: `call-${overrides.subagentId}`,
  startedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('appendSubagentCheckpointSummary', () => {
  it('returns the original summary when there are no subagents', () => {
    expect(appendSubagentCheckpointSummary('Parent recap.', [])).toBe(
      'Parent recap.',
    )
  })

  it('appends the ledger and completed summaries in registration order', () => {
    const records = [
      record({
        agentName: 'explorer',
        subagentId: 'sub-1',
        status: 'completed',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'Mapped the auth module.',
        },
      }),
      record({
        agentName: 'writer',
        subagentId: 'sub-2',
        status: 'running',
      }),
      record({
        agentName: 'reviewer',
        subagentId: 'sub-3',
        status: 'completed',
        result: {
          subagentId: 'sub-3',
          name: 'reviewer',
          summary: 'Tests still fail on login.',
        },
      }),
    ]

    expect(appendSubagentCheckpointSummary('Parent recap.', records)).toBe(
      [
        'Parent recap.',
        buildSubagentLedger(records),
        [
          'Completed subagent results:',
          '- explorer (sub-1): Mapped the auth module.',
          '- reviewer (sub-3): Tests still fail on login.',
        ].join('\n'),
      ].join('\n\n'),
    )
  })

  it('falls back to subagentId when the completed agent name is blank', () => {
    const records = [
      record({
        agentName: '  ',
        subagentId: 'sub-blank',
        status: 'completed',
        result: {
          subagentId: 'sub-blank',
          name: '  ',
          summary: 'Scouted the repo.',
        },
      }),
    ]

    expect(appendSubagentCheckpointSummary('Parent recap.', records)).toContain(
      '- sub-blank (sub-blank): Scouted the repo.',
    )
  })

  it('appends the ledger without summaries when none are completed', () => {
    const records = [
      record({
        agentName: 'explorer',
        subagentId: 'sub-1',
        status: 'running',
      }),
    ]

    expect(appendSubagentCheckpointSummary('Parent recap.', records)).toBe(
      ['Parent recap.', buildSubagentLedger(records)].join('\n\n'),
    )
  })
})
