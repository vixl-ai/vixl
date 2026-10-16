import { tool } from 'ai'
import { z } from 'zod'
import callManagedCodegraphTool from '@/services/harness/codebase/call-managed'
import {
  describeRepoTool,
  repoScopeSummary,
  repoSlugFields,
  withRepoSlug,
} from '@/services/harness/codebase/repo'
import normalizeCodegraphResult from '@/services/codegraph/normalize-codegraph-result'
import { resolveWorkspaceSlug, slugArg } from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const codebaseStatus = (ctx: HarnessToolContext) =>
  tool({
    description: describeRepoTool(
      'Check CodeGraph index health (ready, pending sync, errors).',
      ctx,
    ),
    inputSchema: z.object({
      ...repoSlugFields(ctx),
    }),
    execute: async (input, { toolCallId }) => {
      const requestedRepo = slugArg(input, 'repo')
      const resolved = resolveWorkspaceSlug(ctx, requestedRepo)
      const repo = resolved.slug

      const called = await callManagedCodegraphTool(ctx, {
        toolCallId,
        firstPartyName: 'codebase_status',
        mcpToolName: 'codegraph_status',
        toolArgs: {},
        projectRoot: resolved.projectRoot,
      })
      if (!called.ok) {
        if ('rejected' in called.payload) {
          return withRepoSlug(repo, called.payload)
        }
        return withRepoSlug(repo, {
          ready: false,
          indexing: false,
          syncing: false,
          error: repoScopeSummary(
            ctx,
            requestedRepo,
            repo,
            'check',
            typeof called.payload.error === 'string'
              ? called.payload.error
              : 'CodeGraph status failed',
          ),
        })
      }
      return withRepoSlug(repo, normalizeCodegraphResult.status(called.result))
    },
  })

export default codebaseStatus
