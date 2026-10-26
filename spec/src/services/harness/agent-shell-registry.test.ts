import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import type { AgentShellRecord } from '@/types/harness/agent-shell'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import { mockTauriEvent } from '../../test-utils/mocks/tauri-event'

const shellSpawnTracked = vi.fn<() => Promise<void>>()
const shellKillTracked = vi.fn<() => Promise<{ exitCode: number; signal?: number }>>()

type ExitListener = (event: { payload: { shellId: string; exitCode: number; signal?: number } }) => void

const listen = vi.fn<
  (event: string, handler: ExitListener) => Promise<() => void>
>(async () => () => {})

vi.mock('@tauri-apps/api/event', () => mockTauriEvent({ listen }))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    shellSpawnTracked,
    shellKillTracked,
  }),
)

describe('agent-shell-registry', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    shellSpawnTracked.mockResolvedValue(undefined)
    shellKillTracked.mockResolvedValue({ exitCode: 0 })
    const { resetAgentShellRegistryForTests } = await import(
      '@/services/harness/shell/registry'
    )
    resetAgentShellRegistryForTests()
  })

  it('creates a background shell and tracks it by chat', async () => {
    const { createAgentShell, getAgentShell } = await import(
      '@/services/harness/shell/registry'
    )

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'npm run dev',
    })

    expect(shell.status).toBe('running')
    expect(shell).not.toHaveProperty('description')
    expect(shellSpawnTracked).toHaveBeenCalledWith({
      shellId: shell.shellId,
      projectRoot: '/project',
      command: 'npm run dev',
    })
    expect(getAgentShell(shell.shellId)?.chatId).toBe('chat-1')
    expect(getAgentShell(shell.shellId)?.description).toBeUndefined()
  })

  it('stores a non-empty description on the shell record', async () => {
    const { createAgentShell, getAgentShell } = await import(
      '@/services/harness/shell/registry'
    )

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'npm run dev',
      description: 'Start the server',
    })

    expect(shell.description).toBe('Start the server')
    expect(getAgentShell(shell.shellId)?.description).toBe('Start the server')
  })

  it('omits an empty description from the shell record', async () => {
    const { createAgentShell, getAgentShell } = await import(
      '@/services/harness/shell/registry'
    )

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'npm run dev',
      description: '',
    })

    expect(shell).not.toHaveProperty('description')
    expect(getAgentShell(shell.shellId)?.description).toBeUndefined()
  })

  it('tails shell output to the last N lines', async () => {
    const { tailShellOutput } = await import('@/services/harness/shell/registry')

    const shell: AgentShellRecord = {
      shellId: 'shell-1',
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'echo',
      status: 'running',
      stdout: 'line-1\nline-2\nline-3',
      stderr: 'err-1\nerr-2',
      exitCode: null,
      exitSignal: null,
      startedAt: new Date().toISOString(),
      background: false,
      wakeParent: false,
    }

    const output = tailShellOutput(shell, 2)

    expect(output.stdout).toBe('line-2\nline-3')
    expect(output.stderr).toBe('err-1\nerr-2')
  })

  it('propagates signal deaths from shell exit events', async () => {
    let exitHandler: ExitListener | undefined
    listen.mockImplementation(async (event, handler) => {
      if (event.startsWith('shell-exit-')) {
        exitHandler = handler
      }
      return () => {}
    })

    const { createAgentShell, waitForShellExit, getAgentShell } = await import(
      '@/services/harness/shell/registry'
    )

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 1',
    })

    const waitPromise = waitForShellExit(shell.shellId, 5_000)
    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: -1, signal: 6 },
    })

    await expect(waitPromise).resolves.toEqual({
      exitCode: -1,
      signal: 6,
      timedOut: false,
    })
    expect(getAgentShell(shell.shellId)?.exitSignal).toBe(6)
    expect(getAgentShell(shell.shellId)?.status).toBe('failed')
  })

  it('kills all shells for a chat', async () => {
    const { createAgentShell, killShellsForChat, getAgentShell } = await import(
      '@/services/harness/shell/registry'
    )

    const first = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 10',
    })
    const second = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 20',
    })

    await killShellsForChat('chat-1')

    expect(shellKillTracked).toHaveBeenCalledTimes(2)
    expect(shellKillTracked).toHaveBeenCalledWith(first.shellId)
    expect(shellKillTracked).toHaveBeenCalledWith(second.shellId)
    expect(getAgentShell(first.shellId)?.status).toBe('completed')
    expect(getAgentShell(second.shellId)?.status).toBe('completed')
  })

  it('records the owning subagent on a shell', async () => {
    const { createAgentShell, getAgentShell } = await import(
      '@/services/harness/shell/registry'
    )

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 10',
      subagentId: 'bg-1',
    })

    expect(getAgentShell(shell.shellId)?.subagentId).toBe('bg-1')
  })

  it('keepBackground kill leaves running background subagent shells', async () => {
    const { register, resetSubagentRegistryForTests } = await import(
      '@/services/harness/subagent/registry'
    )
    resetSubagentRegistryForTests()
    register('chat-1', 'bg-1', new AbortController(), {
      toolCallId: 'tc-bg',
      agentName: 'background',
    })
    register(
      'chat-1',
      'block-1',
      new AbortController(),
      { toolCallId: 'tc-block', agentName: 'blocking' },
      { pendingResume: false },
    )

    const { createAgentShell, killShellsForChat, getAgentShell, listShellsForChat } =
      await import('@/services/harness/shell/registry')

    const parent = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 1',
    })
    const background = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 2',
      subagentId: 'bg-1',
    })
    const blocking = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 3',
      subagentId: 'block-1',
    })

    await killShellsForChat('chat-1', { keepBackground: true })

    expect(shellKillTracked).toHaveBeenCalledWith(parent.shellId)
    expect(shellKillTracked).toHaveBeenCalledWith(blocking.shellId)
    expect(shellKillTracked).not.toHaveBeenCalledWith(background.shellId)
    expect(getAgentShell(parent.shellId)?.status).toBe('completed')
    expect(getAgentShell(blocking.shellId)?.status).toBe('completed')
    expect(getAgentShell(background.shellId)?.status).toBe('running')
    expect(listShellsForChat('chat-1').map((shell) => shell.shellId)).toEqual([
      background.shellId,
    ])
  })

  it('recovers when kill races with an already-reaped shell', async () => {
    let exitHandler: ExitListener | undefined
    listen.mockImplementation(async (event, handler) => {
      if (event.startsWith('shell-exit-')) {
        exitHandler = handler
      }
      return () => {}
    })
    shellKillTracked.mockRejectedValueOnce(new Error('Shell not found'))

    const { createAgentShell, killAgentShell, getAgentShell } = await import(
      '@/services/harness/shell/registry'
    )

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 10',
    })

    const killPromise = killAgentShell(shell.shellId)
    await Promise.resolve()
    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: 0 },
    })

    await killPromise

    expect(getAgentShell(shell.shellId)?.status).toBe('completed')
  })

  it('lets running-shell consumers refresh from the registry revision', async () => {
    const {
      agentShellRevision,
      createAgentShell,
      killAgentShell,
      listShellsForChat,
    } = await import('@/services/harness/shell/registry')

    const runningShells = computed(() =>
      agentShellRevision.value >= 0
        ? listShellsForChat('chat-1').filter((shell) => shell.status === 'running')
        : [],
    )

    expect(runningShells.value).toEqual([])

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 10',
    })

    expect(runningShells.value.map((entry) => entry.shellId)).toEqual([
      shell.shellId,
    ])

    await killAgentShell(shell.shellId)

    expect(runningShells.value).toEqual([])
  })

  it('queues a clipped deliverable once when a parent background shell exits', async () => {
    const { clipTerminalOutput } = await import('@/utils/clip-terminal-output')
    type OutputListener = (event: {
      payload: { shellId: string; stream: 'stdout' | 'stderr'; data: string }
    }) => void
    let exitHandler: ExitListener | undefined
    let outputHandler: OutputListener | undefined
    listen.mockImplementation(async (event, handler: ExitListener | OutputListener) => {
      if (event.startsWith('shell-exit-')) {
        exitHandler = handler as ExitListener
      }
      if (event.startsWith('shell-output-')) {
        outputHandler = handler as OutputListener
      }
      return () => {}
    })

    const {
      createAgentShell,
      listDeliverableShellResults,
      markShellResultsDelivered,
      hasPendingShellResume,
      clearPendingShellResume,
      hasRunningParentBackgroundShells,
    } = await import('@/services/harness/shell/registry')

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'npm run build',
      description: 'Build the app',
      toolCallId: 'tc-bg',
      background: true,
      wakeParent: true,
    })

    expect(hasPendingShellResume('chat-1')).toBe(true)
    expect(hasRunningParentBackgroundShells('chat-1')).toBe(true)

    const hugeStdout = `out-${'x'.repeat(40_000)}`
    const hugeStderr = `err-${'y'.repeat(40_000)}`
    outputHandler?.({
      payload: { shellId: shell.shellId, stream: 'stdout', data: hugeStdout },
    })
    outputHandler?.({
      payload: { shellId: shell.shellId, stream: 'stderr', data: hugeStderr },
    })
    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: 0 },
    })
    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: 0 },
    })

    const queued = listDeliverableShellResults('chat-1')
    expect(queued).toEqual([
      {
        toolCallId: 'tc-bg',
        shellId: shell.shellId,
        command: 'npm run build',
        description: 'Build the app',
        exitCode: 0,
        stdout: clipTerminalOutput(hugeStdout),
        stderr: clipTerminalOutput(hugeStderr),
      },
    ])
    expect(queued[0]?.stdout).not.toBe(hugeStdout)
    expect(hasPendingShellResume('chat-1')).toBe(true)
    expect(hasRunningParentBackgroundShells('chat-1')).toBe(false)

    clearPendingShellResume('chat-1')
    expect(hasPendingShellResume('chat-1')).toBe(false)
    expect(listDeliverableShellResults('chat-1')).toHaveLength(1)

    markShellResultsDelivered('chat-1', ['tc-bg'])
    expect(listDeliverableShellResults('chat-1')).toEqual([])
  })

  it('does not queue a result when a foreground shell exits', async () => {
    let exitHandler: ExitListener | undefined
    listen.mockImplementation(async (event, handler) => {
      if (event.startsWith('shell-exit-')) {
        exitHandler = handler
      }
      return () => {}
    })

    const {
      createAgentShell,
      listDeliverableShellResults,
      hasPendingShellResume,
      hasRunningParentBackgroundShells,
    } = await import('@/services/harness/shell/registry')

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'echo hello',
      toolCallId: 'tc-fg',
      background: false,
      wakeParent: false,
    })

    expect(hasPendingShellResume('chat-1')).toBe(false)
    expect(hasRunningParentBackgroundShells('chat-1')).toBe(false)

    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: 0 },
    })

    expect(listDeliverableShellResults('chat-1')).toEqual([])
  })

  it('does not queue when waitForShellExit already has a waiter', async () => {
    let exitHandler: ExitListener | undefined
    listen.mockImplementation(async (event, handler) => {
      if (event.startsWith('shell-exit-')) {
        exitHandler = handler
      }
      return () => {}
    })

    const {
      createAgentShell,
      waitForShellExit,
      listDeliverableShellResults,
    } = await import('@/services/harness/shell/registry')

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 1',
      toolCallId: 'tc-wait',
      background: true,
      wakeParent: true,
    })

    const waitPromise = waitForShellExit(shell.shellId)
    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: 0, signal: 15 },
    })

    await expect(waitPromise).resolves.toEqual({
      exitCode: 0,
      signal: 15,
      timedOut: false,
    })
    expect(listDeliverableShellResults('chat-1')).toEqual([])
  })

  it('does not queue when killAgentShell stops a parent background shell', async () => {
    const {
      createAgentShell,
      killAgentShell,
      listDeliverableShellResults,
      hasPendingShellResume,
    } = await import('@/services/harness/shell/registry')

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 10',
      toolCallId: 'tc-kill',
      background: true,
      wakeParent: true,
    })

    await killAgentShell(shell.shellId)

    expect(listDeliverableShellResults('chat-1')).toEqual([])
    expect(hasPendingShellResume('chat-1')).toBe(true)
  })

  it('does not queue when the exit listener wins the kill race', async () => {
    let exitHandler: ExitListener | undefined
    listen.mockImplementation(async (event, handler) => {
      if (event.startsWith('shell-exit-')) {
        exitHandler = handler
      }
      return () => {}
    })
    shellKillTracked.mockRejectedValueOnce(new Error('Shell not found'))

    const {
      createAgentShell,
      killAgentShell,
      listDeliverableShellResults,
    } = await import('@/services/harness/shell/registry')

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'sleep 10',
      toolCallId: 'tc-race',
      background: true,
      wakeParent: true,
    })

    const killPromise = killAgentShell(shell.shellId)
    await Promise.resolve()
    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: 0 },
    })

    await killPromise

    expect(listDeliverableShellResults('chat-1')).toEqual([])
  })

  it('does not queue when a still-running subagent owns the shell', async () => {
    const { register, resetSubagentRegistryForTests } = await import(
      '@/services/harness/subagent/registry'
    )
    resetSubagentRegistryForTests()
    register('chat-1', 'bg-1', new AbortController(), {
      toolCallId: 'tc-sub',
      agentName: 'background',
    })

    try {
      let exitHandler: ExitListener | undefined
      listen.mockImplementation(async (event, handler) => {
        if (event.startsWith('shell-exit-')) {
          exitHandler = handler
        }
        return () => {}
      })

      const { createAgentShell, listDeliverableShellResults } = await import(
        '@/services/harness/shell/registry'
      )

      const shell = await createAgentShell({
        chatId: 'chat-1',
        projectRoot: '/project',
        command: 'sleep 2',
        toolCallId: 'tc-owned',
        background: true,
        wakeParent: true,
        subagentId: 'bg-1',
      })

      exitHandler?.({
        payload: { shellId: shell.shellId, exitCode: 0 },
      })

      expect(listDeliverableShellResults('chat-1')).toEqual([])
    } finally {
      resetSubagentRegistryForTests()
    }
  })
})
