import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'
import type { FileDiff } from '@/types/harness/file-diff'

const fsStagePreviewWrite = vi.fn<
  (args: { projectRoot: string; path: string; content: string }) => Promise<FileDiff[]>
>()
const fsStagePreviewEdit = vi.fn<
  (args: {
    projectRoot: string
    path: string
    replacements: Array<{ oldString: string; newString: string }>
  }) => Promise<FileDiff[]>
>()
const fsStagePreviewApplyPatch = vi.fn<
  (args: { projectRoot: string; patch: string }) => Promise<FileDiff[]>
>()
const fsWriteFile = vi.fn<
  (args: { projectRoot: string; path: string; content: string }) => Promise<FileDiff>
>()
const fsEditFile = vi.fn<
  (args: {
    projectRoot: string
    path: string
    replacements: Array<{ oldString: string; newString: string }>
  }) => Promise<FileDiff>
>()
const fsApplyPatch = vi.fn<
  (args: { projectRoot: string; patch: string }) => Promise<FileDiff[]>
>()
const fileCheckpointCapture = vi
  .fn<() => Promise<{ path: string; pathHash: string; existed: boolean; capturedAt: string }>>()
  .mockResolvedValue({
  path: 'x',
  pathHash: 'h',
  existed: true,
  capturedAt: 'now',
})

const lspEnsureServer = vi.fn<() => Promise<unknown>>()
const lspRequest = vi.fn<() => Promise<unknown>>()

const gateToolPermission = vi
  .fn<(args: { capability: string }) => Promise<boolean>>()
  .mockResolvedValue(true)

const readMcpConfig = vi.fn<
  (scope: string, projectRoot: string | null) => Promise<unknown>
>()

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsWriteFile,
    fsEditFile,
    fsApplyPatch,
    fsStagePreviewWrite,
    fsStagePreviewEdit,
    fsStagePreviewApplyPatch,
    fileCheckpointCapture,
    lspEnsureServer,
    lspRequest,
    readMcpConfig,
  }),
)

vi.mock('@/services/git/git-repo-info', () => ({
  default: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@/services/harness/permission/gate', () => ({
  gateToolPermission,
}))

const mcpCallTool = vi.fn<
  (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>
>()
const mcpGetStatus = vi.fn<
  (serverId: string, config?: unknown) => Promise<unknown>
>()

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    callTool: (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
    ) => mcpCallTool(serverId, toolName, args),
    getStatus: (serverId: string, config?: unknown) => mcpGetStatus(serverId, config),
    start: vi.fn<() => Promise<void>>(),
    stop: vi.fn<() => Promise<void>>(),
  },
}))

vi.mock('@/services/mcp/mcp-http-client', () => ({
  setMcpElicitationHandler: vi.fn<(handler: unknown) => unknown>((handler) => handler),
}))

vi.mock('@/services/mcp/mcp-auth-gate', () => ({
  requestMcpAuth: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/services/mcp/mcp-trust', () => ({
  isMcpTrusted: vi.fn<() => boolean>(() => true),
  sessionTrusts: new Map(),
  getMcpTrust: vi.fn<() => unknown>(),
  upsertMcpTrustRecord: vi.fn<() => void>(),
  clearSessionTrust: vi.fn<() => void>(),
}))


const createAgentShell = vi.fn<
  (args: { chatId: string; projectRoot: string; command: string }) => Promise<{
    shellId: string
    status: string
    stdout: string
    stderr: string
    exitCode: number | null
    chatId: string
    projectRoot: string
    command: string
    startedAt: string
  }>
>()
const getAgentShell = vi.fn<(shellId: string) => unknown>()
const killAgentShell = vi.fn<(shellId: string) => Promise<unknown>>()
const waitForShellExit = vi.fn<
  (
    shellId: string,
    timeoutMs?: number,
  ) => Promise<{ exitCode: number; signal?: number; timedOut: boolean }>
>()
const tailShellOutput = vi.fn<
  (shell: { stdout: string; stderr: string }, tail?: number) => { stdout: string; stderr: string }
>()

vi.mock('@/services/harness/shell/registry', () => ({
  createAgentShell,
  getAgentShell,
  killAgentShell,
  tailShellOutput,
  waitForShellExit,
  killShellsForChat: vi.fn<() => Promise<void>>(),
  setAgentShellEventEmitter: vi.fn<(chatId: string, handler: unknown) => void>(),
}))

const openStudio = vi.fn<(projectId: string, slug: string, path: string, label?: string) => void>()
const resolveProjectIdByRoot = vi.fn<(root: string) => string | null>(() => 'project-1')

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    openStudio,
    resolveProjectIdByRoot,
    refreshPlanStudioTabs: vi.fn<() => void>(),
  }),
}))


describe('build-tools run_terminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateToolPermission.mockResolvedValue(true)
    createAgentShell.mockResolvedValue({
      shellId: 'shell-1',
      status: 'running',
      stdout: '',
      stderr: '',
      exitCode: null,
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'echo hello',
      startedAt: new Date().toISOString(),
    })
    waitForShellExit.mockResolvedValue({ exitCode: 0, timedOut: false })
    getAgentShell.mockReturnValue({
      shellId: 'shell-1',
      status: 'completed',
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
    })
    killAgentShell.mockResolvedValue({
      shellId: 'shell-1',
      exitCode: 0,
    })
    tailShellOutput.mockImplementation((shell, tail) => ({
      stdout: tail ? shell.stdout.split('\n').slice(-tail).join('\n') : shell.stdout,
      stderr: tail ? shell.stderr.split('\n').slice(-tail).join('\n') : shell.stderr,
    }))
  })

  const ctx = {
    projectRoot: '/project',
    projectSlug: 'project',
    chatId: 'chat-1',
    mode: 'agent' as const,
    userMessageId: 'user-1',
    settings: { version: 1 } as VixlSettings,
    permissionLevel: 'ask' as const,
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
    sandboxEnabled: false,
    supportsVision: false,
    onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
  }

  const runTool = async (
    execute: unknown,
    input: Record<string, unknown>,
    toolCallId = 'tc-shell',
  ): Promise<unknown> => {
    const runner = execute as (
      value: Record<string, unknown>,
      options: { toolCallId: string },
    ) => Promise<unknown>
    return runner(input, { toolCallId })
  }

  it('runs blocking commands and returns stdout', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.run_terminal.execute, { command: 'echo hello' })

    expect(createAgentShell).toHaveBeenCalledWith({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'echo hello',
      sandboxed: true,
      allowNetwork: false,
    })
    expect(waitForShellExit).toHaveBeenCalledWith('shell-1', undefined)
    expect(result).toMatchObject({
      shellId: 'shell-1',
      stdout: 'hello\n',
      exitCode: 0,
      timedOut: false,
      sandboxed: true,
      network: 'deny',
    })
    expect(String((result as { sandboxing: string }).sandboxing)).toContain(
      'SANDBOXING:',
    )
    expect(String((result as { sandboxing: string }).sandboxing)).toContain(
      'Run outside sandbox',
    )
  })

  it('reports signal death in command failed errors', async () => {
    waitForShellExit.mockResolvedValue({ exitCode: -1, signal: 6, timedOut: false })
    getAgentShell.mockReturnValue({
      shellId: 'shell-1',
      status: 'failed',
      stdout: '',
      stderr: 'Aborted',
      exitCode: -1,
      exitSignal: 6,
    })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    await expect(runTool(tools.run_terminal.execute, { command: 'false' })).rejects.toThrow(
      /Command failed \(killed by signal 6\): Aborted/,
    )
    await expect(runTool(tools.run_terminal.execute, { command: 'false' })).rejects.toThrow(
      /SANDBOXING:[\s\S]*Run outside sandbox/,
    )
  })

  it('returns immediately for background commands', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.run_terminal.execute, {
      command: 'npm run dev',
      is_background: true,
    })

    expect(waitForShellExit).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      shellId: 'shell-1',
      status: 'running',
      command: 'npm run dev',
      description: null,
      sandboxed: true,
      network: 'deny',
    })
    expect(String((result as { sandboxing: string }).sandboxing)).toContain(
      'Network: deny',
    )
  })

  it('appends the SANDBOXING footer on timeout errors', async () => {
    waitForShellExit.mockResolvedValue({ exitCode: -1, timedOut: true })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    await expect(
      runTool(tools.run_terminal.execute, {
        command: 'sleep 30',
        timeout_ms: 10,
      }),
    ).rejects.toThrow(/Command timed out after 10ms[\s\S]*SANDBOXING:/)
  })

  it('gates sandboxed shell first, then unsandboxed after spawn denial', async () => {
    createAgentShell
      .mockRejectedValueOnce(new Error('SANDBOX_FAILED: bwrap'))
      .mockResolvedValueOnce({
        shellId: 'shell-1',
        status: 'running',
        stdout: '',
        stderr: '',
        exitCode: null,
        chatId: 'chat-1',
        projectRoot: '/project',
        command: 'echo hello',
        startedAt: new Date().toISOString(),
      })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.run_terminal.execute, { command: 'echo hello' })

    expect(gateToolPermission).toHaveBeenCalledTimes(2)
    expect(gateToolPermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'shell',
        capability: 'shell',
        unsandboxed: false,
      }),
    )
    expect(gateToolPermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'shell.unsandboxed',
        capability: 'shell.unsandboxed',
        unsandboxed: true,
        title: 'echo hello',
      }),
    )
    expect(createAgentShell).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: 'echo hello',
        sandboxed: false,
        allowNetwork: true,
      }),
    )
    expect(result).toMatchObject({
      sandboxed: false,
      network: 'allow',
      priorPhase: {
        sandboxed: true,
        network: 'deny',
        command: 'echo hello',
      },
    })
    expect(String((result as { priorPhase: { error: string } }).priorPhase.error)).toContain(
      'SANDBOX_FAILED: bwrap',
    )
  })

  it('keeps priorPhase when the unsandboxed retry fails', async () => {
    createAgentShell
      .mockRejectedValueOnce(new Error('SANDBOX_FAILED: bwrap'))
      .mockResolvedValueOnce({
        shellId: 'shell-2',
        status: 'running',
        stdout: '',
        stderr: '',
        exitCode: null,
        chatId: 'chat-1',
        projectRoot: '/project',
        command: 'echo hello',
        startedAt: new Date().toISOString(),
      })
    waitForShellExit.mockResolvedValue({ exitCode: 1, timedOut: false })
    getAgentShell.mockReturnValue({
      shellId: 'shell-2',
      status: 'failed',
      stdout: '',
      stderr: 'boom',
      exitCode: 1,
    })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.run_terminal.execute, { command: 'echo hello' })

    expect(result).toMatchObject({
      sandboxed: false,
      network: 'allow',
      command: 'echo hello',
      priorPhase: {
        sandboxed: true,
        command: 'echo hello',
      },
    })
    expect(String((result as { priorPhase: { error: string } }).priorPhase.error)).toContain(
      'SANDBOX_FAILED: bwrap',
    )
    expect(String((result as { error: string }).error)).toContain('Command failed')
    expect(String((result as { error: string }).error)).toContain('boom')
  })

  it('does not double-prompt when sandbox is already off', async () => {
    const unsandboxedCtx = {
      ...ctx,
      settings: { version: 1, 'agent.sandbox.enabled': false } as VixlSettings,
      sandboxEnabled: false,
    }

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(unsandboxedCtx)
    await runTool(tools.run_terminal.execute, { command: 'echo hello' })

    expect(gateToolPermission).toHaveBeenCalledTimes(1)
    expect(gateToolPermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'shell.unsandboxed',
        capability: 'shell.unsandboxed',
        unsandboxed: true,
      }),
    )
    expect(createAgentShell).toHaveBeenCalledTimes(1)
    expect(createAgentShell).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxed: false,
        allowNetwork: false,
      }),
    )
  })

  it('returns a sandboxed denial when the unsandboxed retry is refused', async () => {
    createAgentShell.mockRejectedValueOnce(new Error('SANDBOX_FAILED: bwrap'))
    gateToolPermission
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.run_terminal.execute, { command: 'echo hello' })

    expect(createAgentShell).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      rejected: true,
      sandboxed: true,
      network: 'deny',
    })
    expect(String((result as { error: string }).error)).toContain('SANDBOX_FAILED')
  })

  it('prompts shell.network then retries sandboxed with allowNetwork true', async () => {
    createAgentShell
      .mockRejectedValueOnce(
        new Error(
          'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (network denied).',
        ),
      )
      .mockResolvedValueOnce({
        shellId: 'shell-1',
        status: 'running',
        stdout: '',
        stderr: '',
        exitCode: null,
        chatId: 'chat-1',
        projectRoot: '/project',
        command: 'curl -s https://example.com',
        startedAt: new Date().toISOString(),
      })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.run_terminal.execute, {
      command: 'curl -s https://example.com',
    })

    expect(gateToolPermission).toHaveBeenCalledTimes(2)
    expect(gateToolPermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'shell',
        capability: 'shell',
        unsandboxed: false,
      }),
    )
    expect(gateToolPermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'shell.network',
        capability: 'shell.network',
        unsandboxed: false,
        title: 'curl -s https://example.com',
      }),
    )
    expect(createAgentShell).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: 'curl -s https://example.com',
        sandboxed: true,
        allowNetwork: true,
      }),
    )
    expect(result).toMatchObject({
      sandboxed: true,
      network: 'allow',
      priorPhase: {
        sandboxed: true,
        network: 'deny',
        command: 'curl -s https://example.com',
      },
    })
  })

  it('skips the network hop for isolated devices and goes unsandboxed', async () => {
    createAgentShell
      .mockRejectedValueOnce(
        new Error(
          'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (isolated devices).',
        ),
      )
      .mockResolvedValueOnce({
        shellId: 'shell-1',
        status: 'running',
        stdout: '',
        stderr: '',
        exitCode: null,
        chatId: 'chat-1',
        projectRoot: '/project',
        command: 'lsblk',
        startedAt: new Date().toISOString(),
      })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.run_terminal.execute, { command: 'lsblk' })

    expect(gateToolPermission).toHaveBeenCalledTimes(2)
    expect(gateToolPermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'shell.unsandboxed',
        capability: 'shell.unsandboxed',
        unsandboxed: true,
      }),
    )
    expect(createAgentShell).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sandboxed: false,
        allowNetwork: true,
      }),
    )
    expect(result).toMatchObject({
      sandboxed: false,
      network: 'allow',
      priorPhase: {
        sandboxed: true,
        network: 'deny',
      },
    })
  })

  it('skips the network hop for filesystem jail and goes unsandboxed', async () => {
    createAgentShell
      .mockRejectedValueOnce(
        new Error(
          'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (filesystem EPERM).',
        ),
      )
      .mockResolvedValueOnce({
        shellId: 'shell-1',
        status: 'running',
        stdout: '',
        stderr: '',
        exitCode: null,
        chatId: 'chat-1',
        projectRoot: '/project',
        command: 'find /srv',
        startedAt: new Date().toISOString(),
      })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    await runTool(tools.run_terminal.execute, { command: 'find /srv' })

    expect(gateToolPermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'shell.unsandboxed',
        capability: 'shell.unsandboxed',
        unsandboxed: true,
      }),
    )
    expect(createAgentShell).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sandboxed: false,
        allowNetwork: true,
      }),
    )
  })

  it('skips the network hop when sandbox network is already allow', async () => {
    const networkCtx = {
      ...ctx,
      settings: {
        version: 1,
        'agent.sandbox.enabled': true,
        'agent.sandbox.network': 'allow',
      } as VixlSettings,
    }

    createAgentShell
      .mockRejectedValueOnce(
        new Error(
          'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (network denied).',
        ),
      )
      .mockResolvedValueOnce({
        shellId: 'shell-1',
        status: 'running',
        stdout: '',
        stderr: '',
        exitCode: null,
        chatId: 'chat-1',
        projectRoot: '/project',
        command: 'curl -s https://example.com',
        startedAt: new Date().toISOString(),
      })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(networkCtx)
    await runTool(tools.run_terminal.execute, {
      command: 'curl -s https://example.com',
    })

    expect(createAgentShell).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sandboxed: true,
        allowNetwork: true,
      }),
    )
    expect(gateToolPermission).toHaveBeenCalledTimes(2)
    expect(gateToolPermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'shell.unsandboxed',
        capability: 'shell.unsandboxed',
      }),
    )
    expect(createAgentShell).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sandboxed: false,
        allowNetwork: true,
      }),
    )
  })

  it('hops to unsandboxed when sandboxed network retry is still blocked', async () => {
    createAgentShell
      .mockRejectedValueOnce(
        new Error(
          'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (network denied).',
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (filesystem EPERM).',
        ),
      )
      .mockResolvedValueOnce({
        shellId: 'shell-1',
        status: 'running',
        stdout: '',
        stderr: '',
        exitCode: null,
        chatId: 'chat-1',
        projectRoot: '/project',
        command: 'curl -s https://example.com',
        startedAt: new Date().toISOString(),
      })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.run_terminal.execute, {
      command: 'curl -s https://example.com',
    })

    expect(gateToolPermission).toHaveBeenCalledTimes(3)
    expect(gateToolPermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'shell.network',
        capability: 'shell.network',
      }),
    )
    expect(gateToolPermission).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        action: 'shell.unsandboxed',
        capability: 'shell.unsandboxed',
        unsandboxed: true,
      }),
    )
    expect(createAgentShell).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sandboxed: true,
        allowNetwork: true,
      }),
    )
    expect(createAgentShell).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        sandboxed: false,
        allowNetwork: true,
      }),
    )
    expect(result).toMatchObject({
      sandboxed: false,
      network: 'allow',
      priorPhase: {
        sandboxed: true,
        network: 'allow',
        priorPhase: {
          sandboxed: true,
          network: 'deny',
        },
      },
    })
  })

  it('spawns with allowNetwork when sessionAllows has shell.network', async () => {
    const networkCtx = {
      ...ctx,
      sessionAllows: new Set(['shell.network']),
    }

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(networkCtx)
    await runTool(tools.run_terminal.execute, {
      command: 'curl -s http://127.0.0.1:8096',
    })

    expect(createAgentShell).toHaveBeenCalledTimes(1)
    expect(createAgentShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'curl -s http://127.0.0.1:8096',
        sandboxed: true,
        allowNetwork: true,
      }),
    )
    expect(gateToolPermission).toHaveBeenCalledTimes(1)
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'shell',
        capability: 'shell',
      }),
    )
  })

  it('spawns unsandboxed when sessionAllows has shell.unsandboxed', async () => {
    const unsandboxedCtx = {
      ...ctx,
      sessionAllows: new Set(['shell.unsandboxed']),
    }

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(unsandboxedCtx)
    await runTool(tools.run_terminal.execute, { command: 'ss -tlnp' })

    expect(createAgentShell).toHaveBeenCalledTimes(1)
    expect(createAgentShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'ss -tlnp',
        sandboxed: false,
        allowNetwork: true,
      }),
    )
    expect(gateToolPermission).toHaveBeenCalledTimes(1)
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'shell.unsandboxed',
        capability: 'shell.unsandboxed',
        unsandboxed: true,
      }),
    )
  })

  it('keeps later /var/lib and sqlite commands unsandboxed after elevation', async () => {
    const sessionAllows = new Set<string>()
    const stickyCtx = {
      ...ctx,
      sessionAllows,
    }
    const sqliteCommand =
      'python3 -c "import sqlite3; sqlite3.connect(\'/var/lib/jellyfin/data/jellyfin.db\').execute(\'select 1\')"'

    gateToolPermission.mockImplementation(async (args: { capability: string }) => {
      if (args.capability === 'shell.unsandboxed') {
        sessionAllows.add('shell.unsandboxed')
      }
      return true
    })

    createAgentShell.mockRejectedValueOnce(new Error('SANDBOX_FAILED: bwrap'))

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(stickyCtx)

    await runTool(tools.run_terminal.execute, {
      command: 'cat /var/lib/jellyfin/config.xml',
    })

    expect(sessionAllows.has('shell.unsandboxed')).toBe(true)
    expect(createAgentShell).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: 'cat /var/lib/jellyfin/config.xml',
        sandboxed: false,
        allowNetwork: true,
      }),
    )

    gateToolPermission.mockClear()
    createAgentShell.mockClear()
    createAgentShell.mockResolvedValue({
      shellId: 'shell-1',
      status: 'running',
      stdout: '',
      stderr: '',
      exitCode: null,
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'ls /var/lib/jellyfin',
      startedAt: new Date().toISOString(),
    })

    await runTool(
      tools.run_terminal.execute,
      { command: 'ls /var/lib/jellyfin' },
      'tc-ls-var-lib',
    )

    expect(createAgentShell).toHaveBeenCalledTimes(1)
    expect(createAgentShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'ls /var/lib/jellyfin',
        sandboxed: false,
        allowNetwork: true,
      }),
    )
    expect(gateToolPermission).toHaveBeenCalledTimes(1)
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'shell.unsandboxed',
        capability: 'shell.unsandboxed',
        unsandboxed: true,
      }),
    )
    expect(gateToolPermission).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shell' }),
    )

    gateToolPermission.mockClear()
    createAgentShell.mockClear()
    createAgentShell.mockResolvedValue({
      shellId: 'shell-1',
      status: 'running',
      stdout: '',
      stderr: '',
      exitCode: null,
      chatId: 'chat-1',
      projectRoot: '/project',
      command: sqliteCommand,
      startedAt: new Date().toISOString(),
    })

    await runTool(
      tools.run_terminal.execute,
      { command: sqliteCommand },
      'tc-sqlite-var-lib',
    )

    expect(createAgentShell).toHaveBeenCalledTimes(1)
    expect(createAgentShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: sqliteCommand,
        sandboxed: false,
        allowNetwork: true,
      }),
    )
    expect(gateToolPermission).toHaveBeenCalledTimes(1)
    expect(gateToolPermission).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shell' }),
    )
  })
})
