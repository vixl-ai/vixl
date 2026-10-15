import { tool } from 'ai'
import { z } from 'zod'
import callManagedCodegraphTool from '@/services/harness/codebase/call-managed'
import { describeRepoTool, repoSlugFields } from '@/services/harness/codebase/repo'
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
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      const called = await callManagedCodegraphTool(ctx, {
        toolCallId,
        firstPartyName: 'codebase_status',
        mcpToolName: 'codegraph_status',
        toolArgs: {},
        projectRoot: resolved.projectRoot,
      })
      if (!called.ok) {
        if ('rejected' in called.payload) {
          return called.payload
        }
        return {
          ready: false,
          indexing: false,
          syncing: false,
          error:
            typeof called.payload.error === 'string'
              ? called.payload.error
              : 'CodeGraph status failed',
        }
      }
      return normalizeCodegraphResult.status(called.result)
    },
  })

export default codebaseStatus
