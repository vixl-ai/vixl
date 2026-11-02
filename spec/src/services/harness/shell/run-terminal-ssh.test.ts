import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'
import { SSH_SANDBOX_RETRY_BLOCKED } from '@/services/harness/ssh/model-errors'

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

const gateToolPermission = vi.hoisted(() =>
  vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
)

vi.mock('@/services/harness/permission/gate', () => ({
  gateToolPermission: () => gateToolPermission(),
}))

const createAgentShell = vi.hoisted(() =>
  vi.fn<
    (args: { chatId: string; projectRoot: string; command: string }) => Promise<{
      shellId: string
    }>
  >(),
)
const getAgentShell = vi.hoisted(() => vi.fn<(shellId: string) => unknown>())
const waitForShellExit = vi.hoisted(() =>
  vi.fn<
    (
      shellId: string,
      timeoutMs?: number,
    ) => Promise<{ exitCode: number; signal?: number; timedOut: boolean }>
  >(),
)

vi.mock('@/services/harness/shell/registry', () => ({
  createAgentShell: (args: { chatId: string; projectRoot: string; command: string }) =>
    createAgentShell(args),
  getAgentShell: (shellId: string) => getAgentShell(shellId),
  killAgentShell: vi.fn<() => Promise<unknown>>(),
  tailShellOutput: vi.fn<() => unknown>(),
  waitForShellExit: (
    shellId: string,
    timeoutMs?: number,
  ) => waitForShellExit(shellId, timeoutMs),
  killShellsForChat: vi.fn<() => Promise<void>>(),
  setAgentShellEventEmitter: vi.fn<() => void>(),
}))

import runTerminal from '@/services/harness/shell/run-terminal'
import { sshSessionStatus } from '@/services/vixl/vixl-tauri'

const sshRoot = 'ssh://aidanhibbard@eva/home/aidanhibbard/proj'

const baseCtx = (projectRoot: string, extra?: Partial<VixlSettings>) => ({
  projectRoot,
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent' as const,
  userMessageId: 'user-1',
  settings: { version: 1, 'agent.sandbox.enabled': true, ...extra } as VixlSettings,
  permissionLevel: 'ask' as const,
  sessionAllows: new Set<string>(),
  sessionDenies: new Set<string>(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
})

const execute = async (
  projectRoot: string,
  command: string,
  extra?: Partial<VixlSettings>,
) => {
  const tool = runTerminal(baseCtx(projectRoot, extra))
  const run = tool.execute as unknown as (
    input: { command: string; description: string },
    opts: { toolCallId: string },
  ) => Promise<unknown>
  return run({ command, description: 'run' }, { toolCallId: 'tc-1' })
}

describe('run_terminal ssh retry rule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateToolPermission.mockResolvedValue(true)
    createAgentShell.mockResolvedValue({ shellId: 'sh-1' })
    waitForShellExit.mockResolvedValue({ exitCode: 0, timedOut: false })
    getAgentShell.mockReturnValue({
      stdout: 'operation not permitted',
      stderr: '',
    })
    vi.mocked(sshSessionStatus).mockResolvedValue({
      user: 'aidanhibbard',
      hostname: 'eva',
      port: 22,
      destination: 'eva',
      state: 'connected',
      line: '',
      lastError: null,
      masterAlive: true,
    })
  })

  it('does not unsandbox-retry a local ssh that the sandbox blocked', async () => {
    const result = (await execute('/tmp/project', 'ssh eva ls')) as {
      error?: string
    }
    expect(result.error).toBe(SSH_SANDBOX_RETRY_BLOCKED)
    expect(createAgentShell).toHaveBeenCalledTimes(1)
    expect(createAgentShell).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'ssh eva ls', sandboxed: true }),
    )
  })

  it('omits sandbox retry from the description on an ssh root', () => {
    const tool = runTerminal(baseCtx(sshRoot))
    expect(tool.description).not.toContain(
      'A sandbox block retries unsandboxed automatically within the same call',
    )
  })

  it('keeps sandbox retry in the description on a local root', () => {
    const tool = runTerminal(baseCtx('/tmp/project'))
    expect(tool.description).toContain(
      'A sandbox block retries unsandboxed automatically within the same call',
    )
  })

  it('does not unsandbox-retry Vixl ssh, even when output says operation not permitted', async () => {
    const result = (await execute(sshRoot, 'ls')) as {
      remote?: boolean
      sandboxed?: boolean
      runsAt?: string
    }
    expect(createAgentShell).toHaveBeenCalledTimes(1)
    expect(createAgentShell).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: sshRoot, sandboxed: false }),
    )
    expect(result.remote).toBe(true)
    expect(result.sandboxed).toBeUndefined()
    expect(result.runsAt).toBe('Runs as aidanhibbard on eva')
  })

  it('still unsandbox-retries a local non-ssh sandbox block', async () => {
    getAgentShell
      .mockReturnValueOnce({
        stdout: 'operation not permitted',
        stderr: '',
      })
      .mockReturnValueOnce({
        stdout: 'ok',
        stderr: '',
      })
    waitForShellExit
      .mockResolvedValueOnce({ exitCode: 0, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, timedOut: false })
    createAgentShell
      .mockResolvedValueOnce({ shellId: 'sh-1' })
      .mockResolvedValueOnce({ shellId: 'sh-2' })

    await execute('/tmp/project', 'cat /etc/hosts')
    expect(createAgentShell).toHaveBeenCalledTimes(2)
    expect(createAgentShell).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sandboxed: false, command: 'cat /etc/hosts' }),
    )
  })

  it('treats empty stdout and exit 0 on a dead channel as a dropped session', async () => {
    getAgentShell.mockReturnValue({ stdout: '', stderr: '' })
    waitForShellExit.mockResolvedValue({ exitCode: 0, timedOut: false })
    vi.mocked(sshSessionStatus).mockResolvedValue({
      user: 'aidanhibbard',
      hostname: 'eva',
      port: 22,
      destination: 'eva',
      state: 'disconnected',
      line: '',
      lastError: null,
      masterAlive: false,
    })
    await expect(execute(sshRoot, 'true')).rejects.toThrow(
      'SSH session to eva dropped while this tool was running. The result is incomplete. Do not retry on this Mac.',
    )
  })
})
