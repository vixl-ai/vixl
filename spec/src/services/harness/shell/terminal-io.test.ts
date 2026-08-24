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

const gateToolPermission = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)

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


describe('build-tools terminal io', () => {
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

  it('reads terminal output for a shell id', async () => {
    getAgentShell.mockReturnValue({
      shellId: 'shell-1',
      status: 'running',
      stdout: 'log line\n',
      stderr: '',
      exitCode: null,
      exitSignal: null,
    })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.terminal_output.execute, { shell_id: 'shell-1', tail: 1 })

    expect(tailShellOutput).toHaveBeenCalled()
    expect(result).toMatchObject({
      shellId: 'shell-1',
      status: 'running',
    })
  })

  it('rejects terminal_output when shell_id is a subagent id', async () => {
    const { register, resetSubagentRegistryForTests } = await import(
      '@/services/harness/subagent/registry'
    )
    resetSubagentRegistryForTests()
    register('chat-1', 'subagent-uuid', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })

    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    await expect(
      runTool(tools.terminal_output.execute, { shell_id: 'subagent-uuid' }),
    ).rejects.toThrow(/subagent, not a shell/i)
    expect(getAgentShell).not.toHaveBeenCalled()
  })

  it('stops a background shell', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(tools.stop_terminal.execute, { shell_id: 'shell-1' })

    expect(killAgentShell).toHaveBeenCalledWith('shell-1')
    expect(result).toEqual({ shellId: 'shell-1', exitCode: 0 })
  })
})

