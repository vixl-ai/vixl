import { describe, expect, it } from 'vitest'
import { terminalPhaseStatusKind, terminalPhaseStatusTooltip } from '@/components/chat/chat-terminal-status'

describe('terminalPhaseStatusKind', () => {
  const phase = { output: '', title: 'Sandboxed', exitCode: 0 }

  it('treats exit 0 as ok', () => {
    expect(
      terminalPhaseStatusKind({
        phase,
        isLast: true,
        isRunning: false,
        isError: false,
      }),
    ).toBe('ok')
    expect(terminalPhaseStatusTooltip('ok', 0)).toBe('Exit 0')
  })

  it('treats non-zero exit as fail', () => {
    expect(
      terminalPhaseStatusKind({
        phase: { ...phase, exitCode: 1 },
        isLast: true,
        isRunning: false,
        isError: false,
      }),
    ).toBe('fail')
    expect(terminalPhaseStatusTooltip('fail', 1)).toBe('Exit 1')
  })

  it('treats the last running phase as running', () => {
    expect(
      terminalPhaseStatusKind({
        phase: { output: '', title: 'Terminal' },
        isLast: true,
        isRunning: true,
        isError: false,
      }),
    ).toBe('running')
  })
})
