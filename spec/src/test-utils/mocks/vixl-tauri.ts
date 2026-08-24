import { vi } from 'vitest'

/**
 * Complete mock of `@/services/vixl/vixl-tauri` exports used across tests.
 * Union of every export any test currently stubs.
 *
 * Vitest only hoists `vi.mock` from the test file itself, so call this from a
 * mock factory in the test file:
 *
 *   import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
 *   vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri({ ... }))
 */
export function createVixlTauriMock(overrides: Record<string, unknown> = {}) {
  return {
    isTauri: vi.fn<() => boolean>(() => true),
    getSecret: vi.fn<(key: string) => Promise<string | null>>(async () => null),
    setSecret: vi.fn<(key: string, value: string) => Promise<void>>(async () => {}),
    deleteSecret: vi.fn<(key: string) => Promise<void>>(async () => {}),
    readMcpConfig: vi.fn<() => Promise<{ servers: Record<string, unknown> }>>(async () => ({
      servers: {},
    })),
    listVixlFiles: vi.fn<() => Promise<unknown[]>>(async () => []),
    mcpListStatuses: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({})),
    fsReadFile: vi.fn<() => Promise<{ content: string }>>(async () => ({ content: '' })),
    fsListDir: vi.fn<() => Promise<unknown>>(),
    fsWriteFile: vi.fn<() => Promise<unknown>>(),
    fsEditFile: vi.fn<() => Promise<unknown>>(),
    fsApplyPatch: vi.fn<() => Promise<unknown>>(),
    fsStagePreviewWrite: vi.fn<() => Promise<unknown>>(),
    fsStagePreviewEdit: vi.fn<() => Promise<unknown>>(),
    fsStagePreviewApplyPatch: vi.fn<() => Promise<unknown>>(),
    fileCheckpointCapture: vi
      .fn<() => Promise<{ path: string; pathHash: string; existed: boolean; capturedAt: string }>>()
      .mockResolvedValue({
        path: 'x',
        pathHash: 'h',
        existed: true,
        capturedAt: 'now',
      }),
    workspaceGrep: vi.fn<() => Promise<unknown>>(),
    workspaceGlob: vi.fn<() => Promise<unknown>>(),
    gitStatus: vi.fn<() => Promise<unknown>>(),
    gitDiff: vi.fn<() => Promise<unknown>>(),
    gitLog: vi.fn<() => Promise<unknown>>(),
    lspEnsureServer: vi.fn<() => Promise<unknown>>(),
    lspRequest: vi.fn<() => Promise<unknown>>(),
    mcpCallTool: vi.fn<() => Promise<unknown>>(),
    httpProxyRequest: vi.fn<() => Promise<unknown>>(),
    shellSpawnTracked: vi.fn<() => Promise<void>>(async () => undefined),
    shellKillTracked: vi.fn<() => Promise<{ exitCode: number }>>(async () => ({ exitCode: 0 })),
    createChat: vi.fn<() => Promise<unknown>>(),
    listChats: vi.fn<() => Promise<unknown>>(),
    readChatMeta: vi.fn<() => Promise<unknown>>(),
    readChatMessages: vi.fn<() => Promise<unknown[]>>(async () => []),
    updateChatMeta: vi.fn<() => Promise<unknown>>(),
    ...overrides,
  }
}

/**
 * Alias for createVixlTauriMock. Name starts with `mock` so Vitest allows
 * referencing it inside `vi.mock` factories without `vi.hoisted`.
 *
 * Does not call `vi.mock` itself (Vitest only hoists mocks declared in the
 * test file). Use:
 *
 *   vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri(overrides))
 */
export function mockVixlTauri(overrides: Record<string, unknown> = {}) {
  return createVixlTauriMock(overrides)
}
