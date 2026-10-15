import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MonacoEditorContext,
  MonacoEditorEmit,
} from '@/composables/monaco-editor/types'
import type * as monaco from 'monaco-editor'

const lspRequest = vi.fn<
  (
    serverId: string,
    method: string,
    params: Record<string, unknown>,
    projectRoot?: string | null,
  ) => Promise<unknown>
>()
const lspEnsureServer = vi.fn<
  (extension: string, projectRoot?: string | null) => Promise<{
    id: string
    running: boolean
  }>
>()

vi.mock('@/services/vixl/vixl-tauri', () => ({
  lspRequest: (
    serverId: string,
    method: string,
    params: Record<string, unknown>,
    projectRoot?: string | null,
  ) => lspRequest(serverId, method, params, projectRoot),
  lspEnsureServer: (extension: string, projectRoot?: string | null) =>
    lspEnsureServer(extension, projectRoot),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@vueuse/core', () => ({
  useDebounceFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}))

vi.mock('monaco-editor', () => ({
  editor: {
    setModelMarkers: vi.fn<(...args: unknown[]) => void>(),
  },
}))

import { createLsp } from '@/composables/monaco-editor/lsp'

const fakeModel = {
  getValue: () => 'export const n = 1',
  getOptions: () => ({ tabSize: 2, insertSpaces: true }),
} as unknown as monaco.editor.ITextModel

const createCtx = (root: string | null): MonacoEditorContext =>
  ({
    props: { projectId: 'p-web', path: 'src/main.ts' },
    emit: vi.fn<MonacoEditorEmit>(),
    workbench: {},
    lspStatus: {},
    containerRef: ref(null),
    saving: ref(false),
    editor: null,
    diffEditor: null,
    editorInitializing: false,
    resizeObserver: null,
    lspProviderDisposables: [],
    unlistenDiagnostics: null,
    stopThemeObserver: null,
    lspProvidersRegistered: false,
    viewStateDisposables: [],
    models: new Map([['src/main.ts', fakeModel]]),
    originalModels: new Map(),
    pathByModel: new Map([[fakeModel, 'src/main.ts']]),
    lspServerByPath: new Map(),
    dirtyByPath: new Map(),
    lastLspContentByPath: new Map(),
    lspActive: computed(() => true),
    lineNumbersOption: computed(() => 'on' as const),
    wordWrapOption: computed(() => 'off' as const),
    projectRoot: computed(() => root),
  }) as unknown as MonacoEditorContext

describe('monaco editor LSP requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lspEnsureServer.mockResolvedValue({ id: 'typescript', running: true })
    lspRequest.mockResolvedValue({ items: [] })
  })

  it('passes the tab project root on didOpen and diagnostics', async () => {
    const lsp = createLsp(createCtx('/tmp/web'))
    await lsp.setupLspForPath('src/main.ts', fakeModel)

    expect(lspEnsureServer).toHaveBeenCalledWith('ts', '/tmp/web')
    expect(lspRequest).toHaveBeenCalledWith(
      'typescript',
      'textDocument/didOpen',
      { path: 'src/main.ts', content: 'export const n = 1' },
      '/tmp/web',
    )
    expect(lspRequest).toHaveBeenCalledWith(
      'typescript',
      'diagnostics',
      { path: 'src/main.ts', content: 'export const n = 1' },
      '/tmp/web',
    )
  })

  it('passes the tab project root on didChange, formatting, and didClose', async () => {
    const ctx = createCtx('/tmp/web')
    ctx.lspServerByPath.set('src/main.ts', 'typescript')
    const lsp = createLsp(ctx)

    await lsp.syncDocumentToLsp('src/main.ts', 'changed')
    expect(lspRequest).toHaveBeenCalledWith(
      'typescript',
      'textDocument/didChange',
      { path: 'src/main.ts', content: 'changed' },
      '/tmp/web',
    )

    await lsp.requestFormattingEdits(fakeModel)
    expect(lspRequest).toHaveBeenCalledWith(
      'typescript',
      'textDocument/formatting',
      {
        path: 'src/main.ts',
        options: { tabSize: 2, insertSpaces: true },
      },
      '/tmp/web',
    )

    await lsp.closeLspDocument('src/main.ts')
    expect(lspRequest).toHaveBeenCalledWith(
      'typescript',
      'textDocument/didClose',
      { path: 'src/main.ts' },
      '/tmp/web',
    )
  })

  it('forwards a null tab root so Rust can fall back to the active project', async () => {
    const lsp = createLsp(createCtx(null))
    await lsp.request('typescript', 'hover', { path: 'src/main.ts' })

    expect(lspRequest).toHaveBeenCalledWith(
      'typescript',
      'hover',
      { path: 'src/main.ts' },
      null,
    )
  })
})
