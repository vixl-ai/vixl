import { describe, expect, it } from 'vitest'
import { visibleStatus } from '@/services/harness/guidance'
import buildShellWakeNudge from '@/services/harness/orchestrator/build-shell-wake-nudge'
import type { ShellWakeResult } from '@/types/harness/agent-shell'

const finished: ShellWakeResult = {
  toolCallId: 'tc-1',
  shellId: 'sh-1',
  command: 'npm test',
  description: 'Run tests',
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
}

describe('buildShellWakeNudge', () => {
  it('wraps an all-done wake as a harness envelope with finished output', () => {
    const content = buildShellWakeNudge([finished], [])

    expect(content).toBe(
      [
        '[harness: background terminal results]',
        'Sent by the vixl harness, not a new user request.',
        '',
        `All background terminals have finished. Answer the user from those results. ${visibleStatus('finished')}`,
        '',
        'Finished:',
        '- Run tests (sh-1) exit 0',
        'stdout:',
        'ok',
        'stderr:',
        '',
      ].join('\n'),
    )
  })

  it('names still-running terminals with labels and ids', () => {
    const content = buildShellWakeNudge(
      [finished],
      [
        { shellId: 'sh-2', description: 'Dev server', command: 'npm run dev' },
        { shellId: 'sh-3', command: 'npm run watch' },
      ],
    )

    expect(content).toContain('[harness: background terminal results]')
    expect(content).toContain('Sent by the vixl harness, not a new user request.')
    expect(content).toContain(
      `A background terminal finished. Still running: Dev server (sh-2), npm run watch (sh-3). Either answer about the finished result now or wait for the rest. ${visibleStatus('finished')}`,
    )
    expect(content).toContain('- Run tests (sh-1) exit 0')
  })

  it('includes the signal on the exit line when present', () => {
    const content = buildShellWakeNudge(
      [
        {
          ...finished,
          exitCode: -1,
          signal: 15,
        },
      ],
      [],
    )

    expect(content).toContain('- Run tests (sh-1) exit -1 signal 15')
    expect(content).not.toContain('signal 15,')
  })

  it('still prints stdout and stderr labels when both are empty', () => {
    const content = buildShellWakeNudge(
      [
        {
          toolCallId: 'tc-empty',
          shellId: 'sh-empty',
          command: 'true',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
      ],
      [],
    )

    expect(content).toContain(
      ['- true (sh-empty) exit 0', 'stdout:', '', 'stderr:', ''].join('\n'),
    )
  })
})
