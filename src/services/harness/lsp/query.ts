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
import resolveMemberPath from '@/services/harness/resolve-member-path'
import { withMultiRootPathHint } from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const lspQuery = (ctx: HarnessToolContext) =>
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
        .describe(
          withMultiRootPathHint(
            'Workspace-relative file path (also selects the language server via extension)',
            ctx,
          ),
        ),
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
      let requestPath = path
      let requestRoot: string | undefined
      if (ctx.members && ctx.members.length > 0) {
        const resolved = resolveMemberPath(ctx.members, path)
        requestPath = resolved.relativePath
        requestRoot = resolved.root
      }
      const ext = extension ?? requestPath.split('.').pop() ?? path.split('.').pop() ?? ''
      const server = await (requestRoot
        ? lspEnsureServer(ext, requestRoot)
        : lspEnsureServer(ext)
      ).catch((error: unknown) => failedEnsureState(error))
      const blocked = blockedEnsureResponse(server)
      if (blocked) {
        return {
          method,
          path,
          result: null,
          ...blocked,
        }
      }

      const requestParams: Record<string, unknown> = { path: requestPath }

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
        const result = await (requestRoot
          ? lspRequest(server.id, method, requestParams, requestRoot)
          : lspRequest(server.id, method, requestParams))
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
