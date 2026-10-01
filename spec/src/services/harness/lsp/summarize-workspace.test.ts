import { describe, expect, it } from 'vitest'
import summarizeWorkspace from '@/services/harness/lsp/summarize-workspace'
import type { LspPhase } from '@/services/vixl/vixl-tauri/types'
import type {
  LspWorkspaceDiagnosticFile,
  LspWorkspaceDiagnosticMode,
  LspWorkspaceDiagnosticsResult,
  LspWorkspaceDiagnosticsServer,
} from '@/types/lsp'

const diagnostic = (input: {
  message: string
  severity?: number
  line?: number
  character?: number
  omitRange?: boolean
}): Record<string, unknown> => {
  const record: Record<string, unknown> = {
    message: input.message,
  }
  if (input.severity !== undefined) {
    record.severity = input.severity
  }
  if (!input.omitRange) {
    record.range = {
      start: {
        line: input.line ?? 0,
        character: input.character ?? 0,
      },
    }
  }
  return record
}

const file = (
  path: string,
  diagnostics: unknown,
): LspWorkspaceDiagnosticFile => ({
  uri: `file:///project/${path}`,
  path,
  diagnostics,
})

const server = (input: {
  id: string
  mode: LspWorkspaceDiagnosticMode
  items?: LspWorkspaceDiagnosticFile[]
  error?: string | null
  installState?: LspPhase | null
}): LspWorkspaceDiagnosticsServer => ({
  id: input.id,
  mode: input.mode,
  error: input.error ?? null,
  items: input.items ?? [],
  ...(input.installState !== undefined
    ? { installState: input.installState }
    : {}),
})

const workspace = (
  servers: LspWorkspaceDiagnosticsServer[],
): LspWorkspaceDiagnosticsResult => ({ servers })

describe('summarizeWorkspace', () => {
  it('ranks errors before warnings in items', () => {
    const result = summarizeWorkspace(
      workspace([
        server({
          id: 'typescript',
          mode: 'workspace',
          items: [
            file('src/a.ts', [
              diagnostic({ message: 'warn first', severity: 2, line: 1 }),
              diagnostic({ message: 'error later', severity: 1, line: 2 }),
            ]),
          ],
        }),
      ]),
    )

    expect(result.items.map((item) => item.message)).toEqual([
      'error later',
      'warn first',
    ])
    expect(result.items[0]?.severity).toBe('error')
    expect(result.items[1]?.severity).toBe('warning')
    expect(result.scope).toBe('workspace')
    expect(result.itemCap).toBe(50)
    expect(result.truncated).toBe(false)
  })

  it('drops info and hint diagnostics (severity 3 and 4)', () => {
    const result = summarizeWorkspace(
      workspace([
        server({
          id: 'eslint',
          mode: 'workspace',
          items: [
            file('src/a.ts', [
              diagnostic({ message: 'error', severity: 1 }),
              diagnostic({ message: 'info', severity: 3 }),
              diagnostic({ message: 'hint', severity: 4 }),
              diagnostic({ message: 'warning', severity: 2 }),
            ]),
          ],
        }),
      ]),
    )

    expect(result.items.map((item) => item.message)).toEqual([
      'error',
      'warning',
    ])
    expect(result.errorCount).toBe(1)
    expect(result.warningCount).toBe(1)
  })

  it('treats missing severity as a warning', () => {
    const result = summarizeWorkspace(
      workspace([
        server({
          id: 'typescript',
          mode: 'open_documents',
          items: [
            file('src/a.ts', [diagnostic({ message: 'no severity' })]),
          ],
        }),
      ]),
    )

    expect(result.items).toEqual([
      {
        path: 'src/a.ts',
        severity: 'warning',
        message: 'no severity',
        line: 0,
        character: 0,
        serverId: 'typescript',
      },
    ])
    expect(result.errorCount).toBe(0)
    expect(result.warningCount).toBe(1)
  })

  it('keeps full error and warning totals and truncates items at 50', () => {
    const errors = Array.from({ length: 40 }, (_, index) =>
      diagnostic({ message: `error ${index}`, severity: 1, line: index }),
    )
    const warnings = Array.from({ length: 20 }, (_, index) =>
      diagnostic({ message: `warning ${index}`, severity: 2, line: index }),
    )
    const result = summarizeWorkspace(
      workspace([
        server({
          id: 'typescript',
          mode: 'workspace',
          items: [file('src/a.ts', [...errors, ...warnings])],
        }),
      ]),
    )

    expect(result.errorCount).toBe(40)
    expect(result.warningCount).toBe(20)
    expect(result.itemCap).toBe(50)
    expect(result.truncated).toBe(true)
    expect(result.items).toHaveLength(50)
    expect(result.items.filter((item) => item.severity === 'error')).toHaveLength(
      40,
    )
    expect(
      result.items.filter((item) => item.severity === 'warning'),
    ).toHaveLength(10)
  })

  it('preserves workspace, open_documents, and unavailable server modes', () => {
    const result = summarizeWorkspace(
      workspace([
        server({ id: 'eslint', mode: 'workspace' }),
        server({ id: 'typescript', mode: 'open_documents' }),
        server({ id: 'rust', mode: 'unavailable' }),
      ]),
    )

    expect(result.servers).toEqual([
      { id: 'eslint', mode: 'workspace' },
      { id: 'typescript', mode: 'open_documents' },
      { id: 'rust', mode: 'unavailable' },
    ])
  })

  it('copies installState and error onto the server summary only when present', () => {
    const result = summarizeWorkspace(
      workspace([
        server({
          id: 'ready',
          mode: 'workspace',
          error: null,
        }),
        server({
          id: 'installing',
          mode: 'unavailable',
          error: 'still installing',
          installState: 'installing',
        }),
        server({
          id: 'needs-trust',
          mode: 'unavailable',
          installState: 'needs_trust',
        }),
        server({
          id: 'failed',
          mode: 'unavailable',
          error: 'timed out',
          installState: 'error',
        }),
        server({
          id: 'null-install',
          mode: 'unavailable',
          installState: null,
        }),
      ]),
    )

    expect(result.servers).toEqual([
      { id: 'ready', mode: 'workspace' },
      {
        id: 'installing',
        mode: 'unavailable',
        error: 'still installing',
        installState: 'installing',
      },
      {
        id: 'needs-trust',
        mode: 'unavailable',
        installState: 'needs_trust',
      },
      {
        id: 'failed',
        mode: 'unavailable',
        error: 'timed out',
        installState: 'error',
      },
      { id: 'null-install', mode: 'unavailable' },
    ])
  })

  it('parses diagnostics wrapped in items or diagnostics arrays', () => {
    const result = summarizeWorkspace(
      workspace([
        server({
          id: 'a',
          mode: 'workspace',
          items: [
            file('src/items.ts', {
              items: [diagnostic({ message: 'from items', severity: 1, line: 4 })],
            }),
          ],
        }),
        server({
          id: 'b',
          mode: 'workspace',
          items: [
            file('src/diags.ts', {
              diagnostics: [
                diagnostic({ message: 'from diagnostics', severity: 2, line: 8 }),
              ],
            }),
          ],
        }),
      ]),
    )

    expect(result.items).toEqual([
      {
        path: 'src/items.ts',
        severity: 'error',
        message: 'from items',
        line: 4,
        character: 0,
        serverId: 'a',
      },
      {
        path: 'src/diags.ts',
        severity: 'warning',
        message: 'from diagnostics',
        line: 8,
        character: 0,
        serverId: 'b',
      },
    ])
  })

  it('reads line and character from range.start and defaults to 0', () => {
    const result = summarizeWorkspace(
      workspace([
        server({
          id: 'typescript',
          mode: 'workspace',
          items: [
            file('src/a.ts', [
              diagnostic({
                message: 'with range',
                severity: 1,
                line: 12,
                character: 7,
              }),
              diagnostic({ message: 'no range', severity: 1, omitRange: true }),
            ]),
          ],
        }),
      ]),
    )

    expect(result.items[0]).toMatchObject({
      line: 12,
      character: 7,
    })
    expect(result.items[1]).toMatchObject({
      line: 0,
      character: 0,
    })
  })
})
