import { describe, expect, it } from 'vitest'
import { overlayLiveShellExit } from '@/components/chat/overlay-live-shell-exit'
import { terminalPhaseStatusKind } from '@/components/chat/chat-terminal-status'

describe('overlayLiveShellExit', () => {
  const phase = { output: '', title: 'Sandboxed' }

  it('does not change the phase for a running shell', () => {
    const result = overlayLiveShellExit(phase, { status: 'running', exitCode: null })
    expect(result).toBe(phase)
    expect(
      terminalPhaseStatusKind({
        phase: result,
        isLast: true,
        isRunning: false,
        isError: false,
      }),
    ).toBe('idle')
  })

  it('treats completed exit 0 as ok via terminalPhaseStatusKind', () => {
    const result = overlayLiveShellExit(phase, { status: 'completed', exitCode: 0 })
    expect(
      terminalPhaseStatusKind({
        phase: result,
        isLast: true,
        isRunning: false,
        isError: false,
      }),
    ).toBe('ok')
  })

  it('treats a failed non-zero exit as fail', () => {
    const result = overlayLiveShellExit(phase, { status: 'failed', exitCode: 137 })
    expect(
      terminalPhaseStatusKind({
        phase: result,
        isLast: true,
        isRunning: false,
        isError: false,
      }),
    ).toBe('fail')
  })

  it('leaves the phase alone when the shell is missing', () => {
    expect(overlayLiveShellExit(phase, null)).toBe(phase)
    expect(
      terminalPhaseStatusKind({
        phase,
        isLast: true,
        isRunning: false,
        isError: false,
      }),
    ).toBe('idle')
  })
})
