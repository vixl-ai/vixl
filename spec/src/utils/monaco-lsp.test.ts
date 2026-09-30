import { describe, expect, it } from 'vitest'
import {
  fileExtension,
  lspDiagnosticsToMarkers,
  parseLspCompletionItems,
  parseLspDiagnostics,
  parseLspHoverContents,
  parseLspTextEdits,
} from '@/utils/monaco-lsp'

const monacoStub = {
  MarkerSeverity: {
    Error: 8,
    Warning: 4,
    Info: 2,
    Hint: 1,
  },
  Range: class {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  languages: {
    CompletionItemKind: {
      Text: 0,
      Keyword: 14,
    },
  },
} as unknown as Parameters<typeof lspDiagnosticsToMarkers>[1]

describe('monaco-lsp', () => {
  it('extracts file extensions', () => {
    expect(fileExtension('src/app.ts')).toBe('ts')
    expect(fileExtension('README')).toBe('')
  })

  it('parses diagnostic payloads', () => {
    const diagnostics = parseLspDiagnostics({
      kind: 'full',
      items: [
        {
          message: 'Expected semicolon',
          severity: 1,
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 8 },
          },
        },
      ],
    })

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toBe('Expected semicolon')
  })

  it('parses publishDiagnostics payloads', () => {
    const diagnostics = parseLspDiagnostics({
      diagnostics: [
        {
          message: 'Cannot find module',
          severity: 1,
        },
      ],
    })

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toBe('Cannot find module')
  })

  it('maps diagnostics to monaco markers', () => {
    const markers = lspDiagnosticsToMarkers(
      [
        {
          message: 'Unused variable',
          severity: 2,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 3 },
          },
        },
        {
          message: 'Consider refactoring',
          severity: 3,
        },
      ],
      monacoStub,
    )

    expect(markers).toHaveLength(1)
    expect(markers[0]?.severity).toBe(4)
    expect(markers[0]?.startLineNumber).toBe(1)
  })

  it('parses hover contents', () => {
    expect(parseLspHoverContents({ contents: 'hello' })).toEqual(['hello'])
    expect(
      parseLspHoverContents({
        contents: { kind: 'markdown', value: '**title**' },
      }),
    ).toEqual(['**title**'])
  })

  it('parses completion items', () => {
    const suggestions = parseLspCompletionItems(
      {
        items: [
          {
            label: 'console',
            kind: 14,
            insertText: 'console',
          },
        ],
      },
      monacoStub,
    )

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.label).toBe('console')
    expect(suggestions[0]?.kind).toBe(14)
  })

  it('parses lsp text edits to monaco 1-based ranges', () => {
    expect(parseLspTextEdits(null)).toEqual([])
    expect(parseLspTextEdits({})).toEqual([])

    const edits = parseLspTextEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 2 },
        },
        newText: 'formatted\n',
      },
      {
        range: { start: { line: 2, character: 3 }, end: { line: 2, character: 5 } },
        newText: 'x',
      },
      { newText: 'missing-range' },
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
    ])

    expect(edits).toEqual([
      {
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 2,
          endColumn: 3,
        },
        text: 'formatted\n',
      },
      {
        range: {
          startLineNumber: 3,
          startColumn: 4,
          endLineNumber: 3,
          endColumn: 6,
        },
        text: 'x',
      },
    ])
  })
})
