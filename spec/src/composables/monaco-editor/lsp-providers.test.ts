import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonacoEditorContext } from '@/composables/monaco-editor/types'
import type { MonacoLsp } from '@/composables/monaco-editor/lsp'
import type * as monaco from 'monaco-editor'

const hoverProviders: Array<{
  provideHover: (
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ) => Promise<unknown>
}> = []
const definitionProviders: Array<{
  provideDefinition: (
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ) => Promise<unknown>
}> = []
const completionProviders: Array<{
  provideCompletionItems: (
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ) => Promise<unknown>
}> = []

vi.mock('monaco-editor', () => ({
  Range: class {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  Uri: {
    parse: (value: string) => ({ toString: () => value }),
  },
  languages: {
    registerHoverProvider: (
      _language: string,
      provider: (typeof hoverProviders)[number],
    ) => {
      hoverProviders.push(provider)
      return { dispose: vi.fn<() => void>() }
    },
    registerDefinitionProvider: (
      _language: string,
      provider: (typeof definitionProviders)[number],
    ) => {
      definitionProviders.push(provider)
      return { dispose: vi.fn<() => void>() }
    },
    registerCompletionItemProvider: (
      _language: string,
      provider: (typeof completionProviders)[number],
    ) => {
      completionProviders.push(provider)
      return { dispose: vi.fn<() => void>() }
    },
    registerDocumentFormattingEditProvider: () => ({ dispose: vi.fn<() => void>() }),
    CompletionItemKind: { Text: 0 },
  },
}))

import { createLspProviders } from '@/composables/monaco-editor/lsp-providers'

const fakeModel = {
  getValue: () => 'const x = 1',
} as unknown as monaco.editor.ITextModel

const position = { lineNumber: 1, column: 7 } as monaco.Position

const createCtx = (): MonacoEditorContext =>
  ({
    lspActive: computed(() => true),
    lspProvidersRegistered: false,
    lspProviderDisposables: [],
    containerRef: ref(null),
  }) as unknown as MonacoEditorContext

describe('monaco editor LSP providers', () => {
  const request = vi.fn<
    (serverId: string, method: string, params: Record<string, unknown>) => Promise<unknown>
  >()
  const lsp = {
    resolvePathForModel: () => 'src/main.ts',
    getLspServerId: () => 'typescript',
    serversForLspFeature: () => ['typescript'],
    syncDocumentToLsp: vi.fn<(path: string, content: string) => Promise<void>>(
      async () => undefined,
    ),
    withLspTimeout: async <T>(work: Promise<T>) => work,
    request,
    setupLspForPath: vi.fn<
      (path: string, model: monaco.editor.ITextModel) => Promise<void>
    >(async () => undefined),
    requestFormattingEdits: vi.fn<
      (model: monaco.editor.ITextModel) => Promise<monaco.languages.TextEdit[]>
    >(async () => []),
  } as unknown as MonacoLsp

  beforeEach(() => {
    vi.clearAllMocks()
    hoverProviders.length = 0
    definitionProviders.length = 0
    completionProviders.length = 0
    request.mockResolvedValue({ contents: 'hover text' })
  })

  it('routes hover, definition, and completion through lsp.request', async () => {
    createLspProviders(createCtx(), lsp).registerLspProviders()

    await hoverProviders[0]!.provideHover(fakeModel, position)
    expect(request).toHaveBeenCalledWith('typescript', 'hover', {
      path: 'src/main.ts',
      position: { line: 0, character: 6 },
    })

    request.mockResolvedValue({
      uri: 'file:///tmp/web/src/main.ts',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    })
    await definitionProviders[0]!.provideDefinition(fakeModel, position)
    expect(request).toHaveBeenCalledWith('typescript', 'goToDefinition', {
      path: 'src/main.ts',
      position: { line: 0, character: 6 },
    })

    request.mockResolvedValue({ items: [] })
    await completionProviders[0]!.provideCompletionItems(fakeModel, position)
    expect(request).toHaveBeenCalledWith('typescript', 'textDocument/completion', {
      path: 'src/main.ts',
      position: { line: 0, character: 6 },
    })
  })
})
