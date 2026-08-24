import { tool } from 'ai'
import { z } from 'zod'
import { lspEnsureServer, lspRequest } from '@/services/vixl/vixl-tauri'
import {
  LSP_DIAGNOSTICS_METHODS,
  parseLspDiagnosticItems,
} from '@/services/harness/lsp/parse-diagnostics'
import withToolExamples from '@/services/harness/with-tool-examples'
const lspQuery = () =>
  tool({
    description: withToolExamples(
      'LSP query for precise code intelligence. Prefer over grep for definitions, references, types, and symbols. Methods: goToDefinition, findReferences, hover, symbols, workspaceSymbol, diagnostics. Position line/character are 0-based (not read_file 1-based lines). findReferences always sends context.includeDeclaration (default true). workspaceSymbol requires query. Prefer codebase_* for structural "where is X".',
      [
        {
          method: 'goToDefinition',
          path: 'src/services/harness/build-tools.ts',
          position: { line: 1594, character: 2 },
        },
        {
          method: 'workspaceSymbol',
          path: 'src/services/harness/build-tools.ts',
          query: 'buildTools',
        },
      ],
    ),
    inputSchema: z.object({
      method: z.enum([
        'goToDefinition',
        'findReferences',
        'hover',
        'symbols',
        'workspaceSymbol',
        'diagnostics',
      ]),
      path: z
        .string()
        .describe('Workspace-relative file path (also selects the language server via extension)'),
      extension: z
        .string()
        .optional()
        .describe('Override file extension when path has no usable extension'),
      position: z
        .object({
          line: z
            .number()
            .int()
            .nonnegative()
            .describe('0-based line (Monaco lineNumber - 1). Not read_file 1-based lines.'),
          character: z
            .number()
            .int()
            .nonnegative()
            .describe('0-based UTF-16 character offset (Monaco column - 1).'),
        })
        .optional()
        .describe('Required for goToDefinition, findReferences, and hover'),
      query: z
        .string()
        .optional()
        .describe('Required for workspaceSymbol (symbol name substring)'),
      includeDeclaration: z
        .boolean()
        .optional()
        .describe('findReferences only; defaults to true when omitted'),
    }),
    execute: async ({ method, path, extension, position, query, includeDeclaration }) => {
      const ext = extension ?? path.split('.').pop() ?? ''
      const server = await lspEnsureServer(ext).catch((error: unknown) => ({
        id: '',
        running: false,
        error: error instanceof Error ? error.message : 'LSP ensure failed',
        installState: 'error',
      }))
      if (server.installState === 'installing') {
        return {
          method,
          path,
          result: null,
          error: 'installing',
          installState: 'installing',
        }
      }
      if (!server.running) {
        return {
          method,
          path,
          result: null,
          error: server.error ?? 'LSP unavailable',
          installState: server.installState ?? null,
        }
      }

      const requestParams: Record<string, unknown> = { path }

      if (method === 'goToDefinition' || method === 'findReferences' || method === 'hover') {
        if (!position) {
          return {
            method,
            path,
            result: null,
            error: 'position { line, character } (0-based) is required for this method',
          }
        }
        requestParams.position = position
      }

      if (method === 'findReferences') {
        requestParams.context = {
          includeDeclaration: includeDeclaration ?? true,
        }
      }

      if (method === 'workspaceSymbol') {
        if (!query || query.trim().length === 0) {
          return {
            method,
            path,
            result: null,
            error: 'query is required for workspaceSymbol',
          }
        }
        requestParams.query = query
      }

      try {
        const result = await lspRequest(server.id, method, requestParams)
        if (LSP_DIAGNOSTICS_METHODS.has(method)) {
          return { method, path, diagnostics: parseLspDiagnosticItems(result), result }
        }
        return { method, path, result }
      } catch (error) {
        return {
          method,
          path,
          result: null,
          error: error instanceof Error ? error.message : 'LSP request failed',
        }
      }
    },
  })

export default lspQuery
