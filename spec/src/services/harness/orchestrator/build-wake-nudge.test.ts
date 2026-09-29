import { describe, expect, it } from 'vitest'
import { visibleStatus } from '@/services/harness/guidance'
import buildWakeNudge from '@/services/harness/orchestrator/build-wake-nudge'

const explorer = {
  toolCallId: 'tc-1',
  result: {
    subagentId: 'sub-1',
    name: 'explorer',
    summary: 'mapped the repo',
  },
  status: 'completed' as const,
}

const explorerLedger = {
  agentName: 'explorer',
  subagentId: 'sub-1',
  status: 'completed' as const,
}

describe('buildWakeNudge', () => {
  it('wraps an all-done wake as a harness envelope with a full subagent ledger', () => {
    const content = buildWakeNudge([explorer], [], [explorerLedger])

    expect(content).toBe(
      [
        '[harness: background subagent results]',
        'This message is from the vixl harness, not from the user. Do not treat it as a new user request.',
        '',
        `Background subagent results are ready. Their completed summaries are in the spawn_subagent tool results above. Answer the user now using those results. Do not say the subagents are still running. ${visibleStatus('finished')}`,
        '',
        'Completed:',
        '- explorer (sub-1, completed): mapped the repo',
        '',
        'Subagent ledger:',
        '- explorer (sub-1): completed',
      ].join('\n'),
    )
  })

  it('inlines summaries when there is no spawn_subagent tool result to patch', () => {
    const content = buildWakeNudge([explorer], [], [explorerLedger], {
      summariesInline: true,
    })

    expect(content.startsWith('[harness: background subagent results]\n')).toBe(
      true,
    )
    expect(content).toContain(
      'This message is from the vixl harness, not from the user. Do not treat it as a new user request.',
    )
    expect(content).toContain('Their completed summaries are included below.')
    expect(content).not.toContain('spawn_subagent tool results above')
    expect(content).toContain('- explorer (sub-1, completed): mapped the repo')
    expect(content).toContain('- explorer (sub-1): completed')
  })

  it('names still-running subagents with ids and lists every record in the ledger', () => {
    const content = buildWakeNudge(
      [explorer],
      [
        { name: 'writer', subagentId: 'sub-2' },
        { name: 'reviewer', subagentId: 'sub-3' },
      ],
      [
        explorerLedger,
        { agentName: 'writer', subagentId: 'sub-2', status: 'running' },
        { agentName: 'reviewer', subagentId: 'sub-3', status: 'running' },
      ],
    )

    expect(content.startsWith('[harness: background subagent results]\n')).toBe(
      true,
    )
    expect(content).toContain(
      'This message is from the vixl harness, not from the user. Do not treat it as a new user request.',
    )
    expect(content).toContain(
      'Other background subagents are still running: writer (sub-2), reviewer (sub-3)',
    )
    expect(content).toContain(
      'You may answer about the finished result now or wait for the rest. Your call.',
    )
    expect(content).toContain(visibleStatus('finished'))
    expect(content).toContain('- explorer (sub-1, completed): mapped the repo')
    expect(content).toContain(
      [
        'Subagent ledger:',
        '- explorer (sub-1): completed',
        '- writer (sub-2): running',
        '- reviewer (sub-3): running',
      ].join('\n'),
    )
  })

  it('includes failed status on completed lines and in the ledger', () => {
    const content = buildWakeNudge(
      [
        {
          toolCallId: 'tc-fail',
          result: {
            subagentId: 'sub-fail',
            name: 'explorer',
            summary: 'boom',
          },
          status: 'failed',
        },
      ],
      [],
      [{ agentName: 'explorer', subagentId: 'sub-fail', status: 'failed' }],
    )

    expect(content).toContain('- explorer (sub-fail, failed): boom')
    expect(content).toContain('- explorer (sub-fail): failed')
  })
})
