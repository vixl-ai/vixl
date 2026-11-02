import { describe, expect, it } from 'vitest'
import { parseTerminalToolView } from '@/utils/parse-terminal-tool-view'

describe('parseTerminalToolView ssh', () => {
  it('shows the remote runs-at line and omits Sandboxed and Unsandboxed', () => {
    const view = parseTerminalToolView({
      toolCallId: 't1',
      name: 'run_terminal',
      status: 'done',
      args: { command: 'ls', description: 'list' },
      result: {
        command: 'ls',
        stdout: 'ok',
        exitCode: 0,
        remote: true,
        runsAt: 'Runs as aidanhibbard on eva',
        sandboxed: false,
      },
    })

    expect(view?.runsAt).toBe('Runs as aidanhibbard on eva')
    expect(view?.remote).toBe(true)
    expect(view?.phases[0]?.title).toBe('Terminal')
    expect(view?.phases[0]?.badge).toBeUndefined()
    expect(view?.phases[0]?.sandboxed).toBeUndefined()
  })
})
