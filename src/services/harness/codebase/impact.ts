import { tool } from 'ai'
import { z } from 'zod'
import callManagedCodegraphTool from '@/services/harness/codebase/call-managed'
import { describeRepoTool, repoSlugFields } from '@/services/harness/codebase/repo'
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
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      const called = await callManagedCodegraphTool(ctx, {
        toolCallId,
        firstPartyName: 'codebase_impact',
        mcpToolName: 'codegraph_impact',
        toolArgs,
        projectRoot: resolved.projectRoot,
      })
      if (!called.ok) {
        if ('rejected' in called.payload) {
          return called.payload
        }
        return {
          summary:
            typeof called.payload.error === 'string'
              ? called.payload.error
              : 'CodeGraph impact failed',
          results: [],
        }
      }
      return normalizeCodegraphResult.impact(called.result)
    },
  })

export default codebaseImpact
