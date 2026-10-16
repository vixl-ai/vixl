import { describe, expect, it } from 'vitest'
import buildSubagentLedger from '@/services/harness/orchestrator/build-subagent-ledger'

describe('buildSubagentLedger', () => {
  it('lists every record in registration order as name, id, and status', () => {
    const content = buildSubagentLedger([
      { agentName: 'explorer', subagentId: 'sub-1', status: 'completed' },
      { agentName: 'writer', subagentId: 'sub-2', status: 'running' },
      { agentName: 'reviewer', subagentId: 'sub-3', status: 'failed' },
      { agentName: 'scout', subagentId: 'sub-4', status: 'aborted' },
    ])

    expect(content).toBe(
      [
        'Subagent ledger:',
        '- explorer (sub-1): completed',
        '- writer (sub-2): running',
        '- reviewer (sub-3): failed',
        '- scout (sub-4): aborted',
      ].join('\n'),
    )
  })

  it('includes trimmed summaries on terminal entries', () => {
    const content = buildSubagentLedger([
      {
        agentName: 'explorer',
        subagentId: 'sub-1',
        status: 'completed',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'mapped the repo',
        },
      },
      { agentName: 'writer', subagentId: 'sub-2', status: 'running' },
    ])

    expect(content).toBe(
      [
        'Subagent ledger:',
        '- explorer (sub-1): completed: mapped the repo',
        '- writer (sub-2): running',
      ].join('\n'),
    )
  })

  it('caps long completed summaries and adds an ellipsis', () => {
    const summary = `${'x'.repeat(500)}extra`
    const content = buildSubagentLedger([
      {
        agentName: 'explorer',
        subagentId: 'sub-1',
        status: 'completed',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary,
        },
      },
    ])

    expect(content).toBe(
      `Subagent ledger:\n- explorer (sub-1): completed: ${'x'.repeat(500)}...`,
    )
    expect(content).not.toContain('extra')
  })

  it('falls back to subagentId when the agent name is blank', () => {
    const content = buildSubagentLedger([
      { agentName: '  ', subagentId: 'sub-blank', status: 'running' },
    ])

    expect(content).toContain('- sub-blank (sub-blank): running')
  })

  it('keeps an empty ledger header when there are no records', () => {
    expect(buildSubagentLedger([])).toBe('Subagent ledger:')
  })
})
