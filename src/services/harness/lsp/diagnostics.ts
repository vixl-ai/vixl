import { tool } from 'ai'
import { z } from 'zod'
import {
  blockedEnsureResponse,
  failedEnsureState,
} from '@/services/harness/lsp/failed-ensure-state'
import { parseLspDiagnosticItems } from '@/services/harness/lsp/parse-diagnostics'
import summarizeWorkspace from '@/services/harness/lsp/summarize-workspace'
import {
  lspEnsureServer,
  lspRequest,
  lspWorkspaceDiagnostics,
  type LspServerState,
} from '@/services/vixl/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { LspWorkspaceIssuesResult } from '@/types/lsp'

const workspaceFailure = (message: string): LspWorkspaceIssuesResult => ({
  scope: 'workspace',
  errorCount: 0,
  warningCount: 0,
  itemCap: 50,
  truncated: false,
  items: [],
  servers: [],
  error: message,
})

const executeWorkspace = async (
  projectRoot: string,
): Promise<LspWorkspaceIssuesResult> => {
  try {
    const result = await lspWorkspaceDiagnostics(projectRoot)
    return summarizeWorkspace(result)
  } catch (error: unknown) {
    return workspaceFailure(
      error instanceof Error ? error.message : 'Workspace diagnostics failed',
    )
  }
}

const executeFile = async (
  path: string,
  extension: string | undefined,
  projectRoot: string,
) => {
  const ext = extension ?? path.split('.').pop() ?? ''
  let server: LspServerState
  try {
    server = await lspEnsureServer(ext, projectRoot)
  } catch (error: unknown) {
    server = failedEnsureState(error)
  }
  const blocked = blockedEnsureResponse(server)
  if (blocked) {
    return {
      path,
      diagnostics: [],
      ...blocked,
    }
  }

  try {
    const result = await lspRequest(server.id, 'diagnostics', { path })
    if (result && typeof result === 'object' && 'error' in result) {
      return {
        path,
        diagnostics: [],
        error: String((result as { error: string }).error),
      }
    }
    return { path, diagnostics: parseLspDiagnosticItems(result) }
  } catch (error: unknown) {
    return {
      path,
      diagnostics: [],
      error: error instanceof Error ? error.message : 'Diagnostics request failed',
    }
  }
}

const diagnostics = (ctx: HarnessToolContext) =>
  tool({
    description: 'Read LSP diagnostics, project-wide or one file.',
    inputSchema: z.object({
      path: z.string().optional().describe('Omit for project-wide'),
      extension: z.string().optional().describe('Override extension'),
    }),
    execute: async ({ path, extension }) => {
      const trimmed = path?.trim() ?? ''
      if (!trimmed) {
        return executeWorkspace(ctx.projectRoot)
      }
      return executeFile(trimmed, extension, ctx.projectRoot)
    },
  })

export default diagnostics
