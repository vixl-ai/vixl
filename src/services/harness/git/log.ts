import { tool } from 'ai'
import { z } from 'zod'
import { gitLog as gitLogCommand } from '@/services/vixl/vixl-tauri'
import {
  ipcProjectRoots,
  repoSlugFields,
  resolveWorkspaceSlug,
  slugArg,
  withMultiRootSuffix,
  REPO_TOOL_HINT,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitLog = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootSuffix('Git log', ctx, REPO_TOOL_HINT),
    inputSchema: z.object({
      limit: z.number().optional().describe('Optional commit count'),
      ...repoSlugFields(ctx),
    }),
    execute: async (input) => {
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      return gitLogCommand(resolved.projectRoot, input.limit, ipcProjectRoots(ctx))
    },
  })

export default gitLog
