import { tool } from 'ai'
import { z } from 'zod'
import callManagedCodegraphTool from '@/services/harness/codebase/call-managed'
import { describeRepoTool, repoSlugFields } from '@/services/harness/codebase/repo'
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
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      const called = await callManagedCodegraphTool(ctx, {
        toolCallId,
        firstPartyName: 'codebase_search',
        mcpToolName: 'codegraph_search',
        toolArgs: { query: input.query },
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
              : 'CodeGraph search failed',
          results: [],
        }
      }
      return normalizeCodegraphResult.tool(called.result)
    },
  })

export default codebaseSearch
