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
import resolveMemberPath from '@/services/harness/resolve-member-path'
import { resolveWorkspaceSlug, slugArg } from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { LspWorkspaceIssuesResult } from '@/types/lsp'
import { describeRepoTool, repoSlugFields } from '@/services/harness/codebase/repo'

const workspaceFailure = (message: string): LspWorkspaceIssuesResult => ({
  scope: 'unavailable',
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
  requestRoot?: string,
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
    const result = await (requestRoot
      ? lspRequest(server.id, 'diagnostics', { path }, requestRoot)
      : lspRequest(server.id, 'diagnostics', { path }))
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
    description: describeRepoTool('Read LSP diagnostics, project-wide or one file.', ctx),
    inputSchema: z.object({
      path: z.string().optional().describe('Omit for project-wide'),
      extension: z.string().optional().describe('Override extension'),
      ...repoSlugFields(ctx),
    }),
    execute: async (input) => {
      const trimmed = input.path?.trim() ?? ''
      if (!trimmed) {
        const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
        return executeWorkspace(resolved.projectRoot)
      }
      if (ctx.members && ctx.members.length > 0) {
        const resolvedPath = resolveMemberPath(ctx.members, trimmed)
        return executeFile(
          resolvedPath.relativePath,
          input.extension,
          resolvedPath.root,
          resolvedPath.root,
        )
      }
      return executeFile(trimmed, input.extension, ctx.projectRoot)
    },
  })

export default diagnostics
