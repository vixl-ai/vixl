import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAgentShell = vi.fn<(shellId: string) => { description?: string } | null>()

vi.mock('@/services/harness/shell/registry', () => ({
  getAgentShell: (shellId: string) => getAgentShell(shellId),
}))

describe('withTerminalOutputDescription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAgentShell.mockReturnValue(null)
  })

  it('merges a known shell description onto terminal_output args', async () => {
    getAgentShell.mockReturnValue({ description: 'Start the server' })
    const { withTerminalOutputDescription } = await import(
      '@/services/harness/shell/with-terminal-output-description'
    )

    expect(
      withTerminalOutputDescription('terminal_output', { shell_id: 'shell-1', block: true }),
    ).toEqual({
      shell_id: 'shell-1',
      block: true,
      description: 'Start the server',
    })
    expect(getAgentShell).toHaveBeenCalledWith('shell-1')
  })

  it('leaves args unchanged when the shell is missing', async () => {
    const args = { shell_id: 'missing', block: true }
    const { withTerminalOutputDescription } = await import(
      '@/services/harness/shell/with-terminal-output-description'
    )

    expect(withTerminalOutputDescription('terminal_output', args)).toBe(args)
  })

  it('keeps an existing args.description', async () => {
    getAgentShell.mockReturnValue({ description: 'Start the server' })
    const args = { shell_id: 'shell-1', description: 'Wait for build' }
    const { withTerminalOutputDescription } = await import(
      '@/services/harness/shell/with-terminal-output-description'
    )

    expect(withTerminalOutputDescription('terminal_output', args)).toBe(args)
    expect(getAgentShell).not.toHaveBeenCalled()
  })

  it('leaves other tool names unchanged', async () => {
    getAgentShell.mockReturnValue({ description: 'Start the server' })
    const args = { shell_id: 'shell-1' }
    const { withTerminalOutputDescription } = await import(
      '@/services/harness/shell/with-terminal-output-description'
    )

    expect(withTerminalOutputDescription('run_terminal', args)).toBe(args)
    expect(getAgentShell).not.toHaveBeenCalled()
  })
})
