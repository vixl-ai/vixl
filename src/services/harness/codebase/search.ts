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

const codebaseSearch = (ctx: HarnessToolContext) =>
  tool({
    description: describeRepoTool(
      'Search the CodeGraph index for symbols by name (locations only).',
      ctx,
    ),
    inputSchema: z.object({
      query: z.string().describe('Symbol or partial name'),
      ...repoSlugFields(ctx),
    }),
    execute: async (input, { toolCallId }) => {
      const requestedRepo = slugArg(input, 'repo')
      const resolved = resolveWorkspaceSlug(ctx, requestedRepo)
      const repo = resolved.slug

      const called = await callManagedCodegraphTool(ctx, {
        toolCallId,
        firstPartyName: 'codebase_search',
        mcpToolName: 'codegraph_search',
        toolArgs: { query: input.query },
        projectRoot: resolved.projectRoot,
      })
      if (!called.ok) {
        if ('rejected' in called.payload) {
          return withRepoSlug(repo, called.payload)
        }
        return withRepoSlug(repo, {
          summary: repoScopeSummary(
            ctx,
            requestedRepo,
            repo,
            'search',
            typeof called.payload.error === 'string'
              ? called.payload.error
              : 'CodeGraph search failed',
          ),
          results: [],
        })
      }
      const normalized = normalizeCodegraphResult.tool(called.result)
      if (normalized.results.length === 0 && repo) {
        const summaryBase =
          typeof normalized.summary === 'string' && normalized.summary.trim().length > 0
            ? normalized.summary
            : `No results found for "${input.query}"`
        return withRepoSlug(repo, {
          ...normalized,
          summary: repoScopeSummary(ctx, requestedRepo, repo, 'search', summaryBase),
        })
      }
      return withRepoSlug(repo, normalized)
    },
  })

export default codebaseSearch
