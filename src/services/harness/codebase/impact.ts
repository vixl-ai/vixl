import { tool } from 'ai'
import { z } from 'zod'
import callManagedCodegraphTool from '@/services/harness/codebase/call-managed'
import normalizeCodegraphResult from '@/services/codegraph/normalize-codegraph-result'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const codebaseImpact = (ctx: HarnessToolContext) =>
  tool({
    description: 'CodeGraph change impact for a symbol.',
    inputSchema: z.object({
      symbol: z.string().describe('Symbol name'),
      file: z.string().optional().describe('Optional path to disambiguate'),
      depth: z.number().optional().describe('Traversal depth (default 2)'),
    }),
    execute: async ({ symbol, file, depth }, { toolCallId }) => {
      const toolArgs: Record<string, unknown> = { symbol }
      if (typeof file === 'string' && file.length > 0) {
        toolArgs.file = file
      }
      if (typeof depth === 'number' && Number.isFinite(depth)) {
        toolArgs.depth = depth
      }
      const called = await callManagedCodegraphTool(ctx, {
        toolCallId,
        firstPartyName: 'codebase_impact',
        mcpToolName: 'codegraph_impact',
        toolArgs,
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
