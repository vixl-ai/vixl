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
    expect(shellSpawnTracked).toHaveBeenCalledWith({
      shellId: shell.shellId,
      projectRoot: '/project',
      command: 'npm run dev',
    })
    expect(getAgentShell(shell.shellId)?.chatId).toBe('chat-1')
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
})
