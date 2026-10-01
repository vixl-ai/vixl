import { tool } from 'ai'
import { z } from 'zod'
import {
  blockedEnsureResponse,
  failedEnsureState,
} from '@/services/harness/lsp/failed-ensure-state'
import {
  LSP_DIAGNOSTICS_METHODS,
  parseLspDiagnosticItems,
} from '@/services/harness/lsp/parse-diagnostics'
import { lspEnsureServer, lspRequest } from '@/services/vixl/vixl-tauri'

const lspQuery = () =>
  tool({
    description: 'LSP query for precise code intelligence.',
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
            .describe('0-based line, one less than read_file line numbers'),
          character: z
            .number()
            .int()
            .nonnegative()
            .describe('0-based UTF-16 column'),
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
        .describe('findReferences only, default true'),
    }),
    execute: async ({ method, path, extension, position, query, includeDeclaration }) => {
      const ext = extension ?? path.split('.').pop() ?? ''
      const server = await lspEnsureServer(ext).catch((error: unknown) =>
        failedEnsureState(error),
      )
      const blocked = blockedEnsureResponse(server)
      if (blocked) {
        return {
          method,
          path,
          result: null,
          ...blocked,
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
