import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LspServerState } from '@/services/vixl/vixl-tauri'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const { lspEnsureServer, lspRequest, lspWorkspaceDiagnostics } = vi.hoisted(
  () => ({
    lspEnsureServer: vi.fn<() => Promise<unknown>>(),
    lspRequest: vi.fn<() => Promise<unknown>>(),
    lspWorkspaceDiagnostics: vi.fn<() => Promise<unknown>>(),
  }),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    lspEnsureServer,
    lspRequest,
    lspWorkspaceDiagnostics,
  }),
)

import diagnostics from '@/services/harness/lsp/diagnostics'

const serverState = (overrides: Partial<LspServerState> = {}): LspServerState => {
  const phase = overrides.phase ?? 'running'
  return {
    id: 'typescript',
    phase,
    generation: 1,
    revision: 1,
    phaseSinceMs: 0,
    message: null,
    error: null,
    activity: null,
    source: 'managed',
    workspaceRoot: '/project',
    pid: 1,
    running: phase === 'running',
    ...overrides,
  }
}

const ctx: HarnessToolContext = {
  projectRoot: '/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  userMessageId: 'user-1',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set<string>(),
  sessionDenies: new Set<string>(),
  sandboxEnabled: false,
  supportsVision: false,
  onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
}

const runTool = async (input: Record<string, unknown>): Promise<unknown> => {
  const built = diagnostics(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'tc-diag' })
}

describe('diagnostics tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lspEnsureServer.mockResolvedValue(serverState())
    lspRequest.mockResolvedValue({ items: [] })
    lspWorkspaceDiagnostics.mockResolvedValue({
      servers: [
        {
          id: 'typescript',
          mode: 'open_documents',
          error: null,
          items: [
            {
              uri: 'file:///project/src/a.ts',
              path: 'src/a.ts',
              diagnostics: [
                {
                  message: 'Type error',
                  severity: 1,
                  range: { start: { line: 3, character: 1 } },
                },
              ],
            },
          ],
        },
      ],
    })
  })

  it('omits path and loads workspace diagnostics without ensuring a file server', async () => {
    const result = await runTool({})

    expect(lspWorkspaceDiagnostics).toHaveBeenCalledWith('/project')
    expect(lspEnsureServer).not.toHaveBeenCalled()
    expect(lspRequest).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      scope: 'workspace',
      errorCount: 1,
      warningCount: 0,
      truncated: false,
      items: [
        {
          path: 'src/a.ts',
          severity: 'error',
          message: 'Type error',
          line: 3,
          character: 1,
          serverId: 'typescript',
        },
      ],
      servers: [{ id: 'typescript', mode: 'open_documents' }],
    })
  })

  it('treats a blank path as workspace diagnostics', async () => {
    const result = await runTool({ path: '   ' })

    expect(lspWorkspaceDiagnostics).toHaveBeenCalledWith('/project')
    expect(lspEnsureServer).not.toHaveBeenCalled()
    expect(lspRequest).not.toHaveBeenCalled()
    expect(result).toMatchObject({ scope: 'workspace' })
  })

  it('returns a workspace error payload when lspWorkspaceDiagnostics throws', async () => {
    lspWorkspaceDiagnostics.mockRejectedValue(new Error('bridge down'))
    const result = await runTool({})

    expect(result).toEqual({
      scope: 'workspace',
      errorCount: 0,
      warningCount: 0,
      itemCap: 50,
      truncated: false,
      items: [],
      servers: [],
      error: 'bridge down',
    })
    expect(lspEnsureServer).not.toHaveBeenCalled()
    expect(lspRequest).not.toHaveBeenCalled()
  })

  it('ensures the language server and requests file diagnostics when path is set', async () => {
    lspRequest.mockResolvedValue({
      items: [
        {
          message: 'Unused',
          severity: 2,
          range: { start: { line: 1, character: 0 } },
        },
      ],
    })

    const result = await runTool({ path: 'src/main.ts' })

    expect(lspEnsureServer).toHaveBeenCalledWith('ts', '/project')
    expect(lspRequest).toHaveBeenCalledWith('typescript', 'diagnostics', {
      path: 'src/main.ts',
    })
    expect(lspWorkspaceDiagnostics).not.toHaveBeenCalled()
    expect(result).toEqual({
      path: 'src/main.ts',
      diagnostics: [
        {
          message: 'Unused',
          severity: 2,
          range: { start: { line: 1, character: 0 } },
        },
      ],
    })
  })

  it('returns installing without calling lspRequest', async () => {
    lspEnsureServer.mockResolvedValue(
      serverState({ phase: 'installing', running: false, message: 'Downloading' }),
    )

    const result = await runTool({ path: 'src/main.ts' })

    expect(result).toEqual({
      path: 'src/main.ts',
      diagnostics: [],
      error: 'installing',
      installState: 'installing',
    })
    expect(lspRequest).not.toHaveBeenCalled()
  })

  it('returns still starting without calling lspRequest', async () => {
    lspEnsureServer.mockResolvedValue(
      serverState({
        phase: 'starting',
        running: false,
        error: 'Start already in progress for typescript',
      }),
    )

    const result = await runTool({ path: 'src/main.ts' })

    expect(result).toEqual({
      path: 'src/main.ts',
      diagnostics: [],
      error: 'still starting',
      installState: 'starting',
    })
    expect(lspRequest).not.toHaveBeenCalled()
  })

  it('returns stopping without calling lspRequest', async () => {
    lspEnsureServer.mockResolvedValue(
      serverState({ phase: 'stopping', running: false }),
    )

    const result = await runTool({ path: 'src/main.ts' })

    expect(result).toEqual({
      path: 'src/main.ts',
      diagnostics: [],
      error: 'stopping',
      installState: 'stopping',
    })
    expect(lspRequest).not.toHaveBeenCalled()
  })

  it('returns the server error when the language server is not running', async () => {
    lspEnsureServer.mockResolvedValue(
      serverState({ phase: 'missing', running: false, error: 'not installed' }),
    )

    const result = await runTool({ path: 'src/main.ts' })

    expect(result).toEqual({
      path: 'src/main.ts',
      diagnostics: [],
      error: 'not installed',
      installState: 'missing',
    })
    expect(lspRequest).not.toHaveBeenCalled()
  })

  it('returns the phase when the server needs trust', async () => {
    lspEnsureServer.mockResolvedValue(
      serverState({
        phase: 'needs_trust',
        running: false,
        error: 'Workspace is not trusted',
      }),
    )

    const result = await runTool({ path: 'src/main.ts' })

    expect(result).toEqual({
      path: 'src/main.ts',
      diagnostics: [],
      error: 'Workspace is not trusted',
      installState: 'needs_trust',
    })
    expect(lspRequest).not.toHaveBeenCalled()
  })

  it('builds an error state when ensure throws', async () => {
    lspEnsureServer.mockRejectedValue(new Error('bridge down'))

    const result = await runTool({ path: 'src/main.ts' })

    expect(result).toEqual({
      path: 'src/main.ts',
      diagnostics: [],
      error: 'bridge down',
      installState: 'error',
    })
    expect(lspRequest).not.toHaveBeenCalled()
  })

  it('uses the fallback message when ensure throws a non-error', async () => {
    lspEnsureServer.mockRejectedValue('nope')

    const result = await runTool({ path: 'src/main.ts' })

    expect(result).toEqual({
      path: 'src/main.ts',
      diagnostics: [],
      error: 'LSP ensure failed',
      installState: 'error',
    })
  })

  it('parses per-file diagnostics from an items payload', async () => {
    lspRequest.mockResolvedValue({
      items: [
        {
          message: 'Cannot find name',
          severity: 1,
          range: { start: { line: 9, character: 2 } },
        },
      ],
    })

    const result = await runTool({ path: 'src/main.ts' })

    expect(result).toEqual({
      path: 'src/main.ts',
      diagnostics: [
        {
          message: 'Cannot find name',
          severity: 1,
          range: { start: { line: 9, character: 2 } },
        },
      ],
    })
  })
})
