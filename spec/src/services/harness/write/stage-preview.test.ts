import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { FileDiff } from '@/types/harness/file-diff'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

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

const sampleDiff: FileDiff = {
  path: 'src/main.ts',
  operation: 'update',
  hunks: [],
}

describe('build-tools stage preview wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStagePreviewWrite.mockResolvedValue([sampleDiff])
    fsStagePreviewEdit.mockResolvedValue([sampleDiff])
    fsStagePreviewApplyPatch.mockResolvedValue([sampleDiff])
    fsWriteFile.mockResolvedValue(sampleDiff)
    fsEditFile.mockResolvedValue(sampleDiff)
    fsApplyPatch.mockResolvedValue([sampleDiff])
    gateToolPermission.mockResolvedValue(true)
    fileCheckpointCapture.mockResolvedValue({
      path: 'x',
      pathHash: 'h',
      existed: true,
      capturedAt: 'now',
    })
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
    toolCallId: string,
  ): Promise<unknown> => {
    const runner = execute as (
      value: Record<string, unknown>,
      options: { toolCallId: string },
    ) => Promise<unknown>
    return runner(input, { toolCallId })
  }

  it('write_file stages preview with tagged write request', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    await runTool(tools.write_file.execute, { path: 'src/main.ts', content: 'next' }, 'tc-1')

    expect(fsStagePreviewWrite).toHaveBeenCalledWith({
      projectRoot: '/project',
      path: 'src/main.ts',
      content: 'next',
    })
    expect(fsWriteFile).toHaveBeenCalledWith({
      projectRoot: '/project',
      path: 'src/main.ts',
      content: 'next',
    })
    expect(fileCheckpointCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'src/main.ts',
        userMessageId: 'user-1',
        chatId: 'chat-1',
      }),
    )
    expect(fileCheckpointCapture.mock.invocationCallOrder[0]).toBeLessThan(
      fsWriteFile.mock.invocationCallOrder[0]!,
    )
  })

  it('edit_file stages preview with replacements', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    await runTool(
      tools.edit_file.execute,
      { path: 'src/main.ts', old_string: 'old', new_string: 'new' },
      'tc-2',
    )

    expect(fsStagePreviewEdit).toHaveBeenCalledWith({
      projectRoot: '/project',
      path: 'src/main.ts',
      replacements: [{ oldString: 'old', newString: 'new' }],
    })
    expect(fsEditFile).toHaveBeenCalledWith({
      projectRoot: '/project',
      path: 'src/main.ts',
      replacements: [{ oldString: 'old', newString: 'new' }],
    })
  })

  it('apply_patch stages preview before applying', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const patch = '*** Update File: src/main.ts\n@@\n-old\n+new'
    await runTool(tools.apply_patch.execute, { patch }, 'tc-3')

    expect(fsStagePreviewApplyPatch).toHaveBeenCalledWith({
      projectRoot: '/project',
      patch,
    })
    expect(fsApplyPatch).toHaveBeenCalledWith({
      projectRoot: '/project',
      patch,
    })
  })
})

