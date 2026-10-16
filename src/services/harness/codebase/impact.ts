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

const codebaseImpact = (ctx: HarnessToolContext) =>
  tool({
    description: describeRepoTool('CodeGraph change impact for a symbol.', ctx),
    inputSchema: z.object({
      symbol: z.string().describe('Symbol name'),
      file: z.string().optional().describe('Optional path to disambiguate'),
      depth: z.number().optional().describe('Traversal depth (default 2)'),
      ...repoSlugFields(ctx),
    }),
    execute: async (input, { toolCallId }) => {
      const toolArgs: Record<string, unknown> = { symbol: input.symbol }
      if (typeof input.file === 'string' && input.file.length > 0) {
        toolArgs.file = input.file
      }
      if (typeof input.depth === 'number' && Number.isFinite(input.depth)) {
        toolArgs.depth = input.depth
      }
      const requestedRepo = slugArg(input, 'repo')
      const resolved = resolveWorkspaceSlug(ctx, requestedRepo)
      const repo = resolved.slug

      const called = await callManagedCodegraphTool(ctx, {
        toolCallId,
        firstPartyName: 'codebase_impact',
        mcpToolName: 'codegraph_impact',
        toolArgs,
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
            'analyze',
            typeof called.payload.error === 'string'
              ? called.payload.error
              : 'CodeGraph impact failed',
          ),
          results: [],
        })
      }
      const normalized = normalizeCodegraphResult.impact(called.result)
      if (normalized.results.length === 0 && repo) {
        const summaryBase =
          typeof normalized.summary === 'string' && normalized.summary.trim().length > 0
            ? normalized.summary
            : `No results found for "${input.symbol}"`
        return withRepoSlug(repo, {
          ...normalized,
          summary: repoScopeSummary(ctx, requestedRepo, repo, 'analyze', summaryBase),
        })
      }
      return withRepoSlug(repo, normalized)
    },
  })

export default codebaseImpact
