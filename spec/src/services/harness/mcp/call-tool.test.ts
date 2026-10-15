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
  (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    config?: unknown,
    scopeKey?: string,
  ) => Promise<unknown>
>()
const mcpGetStatus = vi.fn<
  (serverId: string, config?: unknown, scopeKey?: string) => Promise<unknown>
>()

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    callTool: (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
      config?: unknown,
      scopeKey?: string,
    ) => mcpCallTool(serverId, toolName, args, config, scopeKey),
    getStatus: (serverId: string, config?: unknown, scopeKey?: string) =>
      mcpGetStatus(serverId, config, scopeKey),
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

import { isMcpTrusted } from '@/services/mcp/mcp-trust'


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

const resolveProjectIdByRoot = vi.fn<(root: string) => string | null>(() => 'project-1')

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    resolveProjectIdByRoot,
    refreshPlanTabs: vi.fn<() => void>(),
  }),
}))


describe('build-tools call_mcp_tool args normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateToolPermission.mockResolvedValue(true)
    readMcpConfig.mockImplementation(async (scope: string) => {
      if (scope === 'personal') {
        return {
          servers: {
            brave: { command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'] },
          },
        }
      }
      return null
    })
    mcpGetStatus.mockResolvedValue({
      serverId: 'brave',
      status: 'connected',
      tools: [
        {
          name: 'brave_web_search',
          description: 'Search the web',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
          },
        },
      ],
      error: null,
    })
    mcpCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    vi.mocked(isMcpTrusted).mockReturnValue(true)
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

  it('returns a clear validation error and skips MCP for nested string args', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(
      tools.call_mcp_tool.execute,
      {
        serverId: 'brave',
        tool: 'brave_web_search',
        args: { query: { test: 'search' } },
      },
      'tc-mcp-nested',
    )

    expect(result).toMatchObject({
      isError: true,
      error: expect.stringContaining('Expected args.query to be string, got object'),
    })
    expect(mcpCallTool).not.toHaveBeenCalled()
  })

  it('unwraps self-nested string args before calling MCP', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    await runTool(
      tools.call_mcp_tool.execute,
      {
        serverId: 'brave',
        tool: 'brave_web_search',
        args: { query: { query: 'Brave Search API' } },
      },
      'tc-mcp-unwrap',
    )

    expect(mcpCallTool).toHaveBeenCalledWith(
      'brave',
      'brave_web_search',
      {
        query: 'Brave Search API',
      },
      undefined,
      'personal',
    )
  })

  it('returns a missing-config error when the server is absent', async () => {
    readMcpConfig.mockResolvedValue({ servers: {} })
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(
      tools.call_mcp_tool.execute,
      {
        serverId: 'brave',
        tool: 'brave_web_search',
        args: { query: 'search' },
      },
      'tc-mcp-missing',
    )

    expect(result).toEqual({
      error:
        'MCP server "brave" was not found in any mcp.json config. It may have been removed, or the config failed to load.',
    })
    expect(mcpCallTool).not.toHaveBeenCalled()
  })

  it('returns the trust error when the server is present but untrusted', async () => {
    vi.mocked(isMcpTrusted).mockReturnValue(false)
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(
      tools.call_mcp_tool.execute,
      {
        serverId: 'brave',
        tool: 'brave_web_search',
        args: { query: 'search' },
      },
      'tc-mcp-untrusted',
    )

    expect(result).toEqual({
      error:
        'MCP server "brave" is not trusted yet. Starting it in Settings, MCP grants trust.',
    })
    expect(mcpCallTool).not.toHaveBeenCalled()
  })

  it('stages MCP image blocks and returns placeholders instead of base64', async () => {
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }],
    })
    const stageImage = vi.fn<(image: {
      dataUrl: string
      mediaType: string
      source: string
    }) => Promise<void>>().mockResolvedValue()
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools({ ...ctx, supportsVision: true, stageImage })
    const result = await runTool(
      tools.call_mcp_tool.execute,
      {
        serverId: 'brave',
        tool: 'brave_web_search',
        args: { query: 'search' },
      },
      'tc-mcp-image-stage',
    )

    expect(stageImage).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,QUJD',
      mediaType: 'image/png',
      source: 'brave/brave_web_search',
    })
    const serialized = JSON.stringify(result)
    expect(serialized).toContain('[image loaded into context]')
    expect(serialized).not.toContain('QUJD')
  })

  it('strips MCP image bytes when the agent cannot view images', async () => {
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }],
    })
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const result = await runTool(
      tools.call_mcp_tool.execute,
      {
        serverId: 'brave',
        tool: 'brave_web_search',
        args: { query: 'search' },
      },
      'tc-mcp-image-no-vision',
    )

    const serialized = JSON.stringify(result)
    expect(serialized).toContain('[image loaded into context]')
    expect(serialized).not.toContain('QUJD')
    expect(serialized).toContain(
      'This MCP tool result includes an image, but this agent cannot receive tool images.',
    )
  })

  it('notes when an image block cannot be staged because mimeType is missing', async () => {
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'image', data: 'QUJD' }],
    })
    const stageImage = vi.fn<(image: {
      dataUrl: string
      mediaType: string
      source: string
    }) => Promise<void>>().mockResolvedValue()
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools({ ...ctx, supportsVision: true, stageImage })
    const result = await runTool(
      tools.call_mcp_tool.execute,
      {
        serverId: 'brave',
        tool: 'brave_web_search',
        args: { query: 'search' },
      },
      'tc-mcp-image-missing-mime',
    )

    expect(stageImage).not.toHaveBeenCalled()
    const serialized = JSON.stringify(result)
    expect(serialized).toContain('[image loaded into context]')
    expect(serialized).not.toContain('QUJD')
    expect(serialized).toContain(
      'An image in the tool result could not be loaded into context.',
    )
  })

  it('passes text-only MCP results through without staging', async () => {
    const stageImage = vi.fn<(image: {
      dataUrl: string
      mediaType: string
      source: string
    }) => Promise<void>>().mockResolvedValue()
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools({ ...ctx, supportsVision: true, stageImage })
    const result = await runTool(
      tools.call_mcp_tool.execute,
      {
        serverId: 'brave',
        tool: 'brave_web_search',
        args: { query: 'search' },
      },
      'tc-mcp-text-only',
    )

    expect(stageImage).not.toHaveBeenCalled()
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
  })

  it('calls a qualified member server using that project root as scopeKey', async () => {
    const apiRoot = '/tmp/api'
    const webRoot = '/tmp/web'
    readMcpConfig.mockImplementation(async (scope: string, rootPath?: string | null) => {
      if (scope === 'personal') {
        return { servers: {} }
      }
      if (rootPath === apiRoot) {
        return { servers: { docs: { command: 'npx', args: ['-y', 'api-docs'] } } }
      }
      if (rootPath === webRoot) {
        return { servers: { docs: { command: 'npx', args: ['-y', 'web-docs'] } } }
      }
      return { servers: {} }
    })
    mcpGetStatus.mockResolvedValue({
      serverId: 'docs',
      status: 'connected',
      tools: [
        {
          name: 'search_docs',
          description: 'Search',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      error: null,
    })
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools({
      ...ctx,
      projectRoot: apiRoot,
      members: [
        { slug: 'api', name: 'API', rootPath: apiRoot },
        { slug: 'web', name: 'Web', rootPath: webRoot },
      ],
    })
    await runTool(
      tools.call_mcp_tool.execute,
      {
        serverId: 'web:docs',
        tool: 'search_docs',
        args: {},
      },
      'tc-mcp-qualified',
    )

    expect(mcpCallTool).toHaveBeenCalledWith(
      'docs',
      'search_docs',
      {},
      undefined,
      webRoot,
    )
  })
})

