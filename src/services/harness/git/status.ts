import { tool } from 'ai'
import { z } from 'zod'
import { gitStatus as gitStatusCommand } from '@/services/vixl/vixl-tauri'
import {
  ipcProjectRoots,
  repoSlugFields,
  resolveWorkspaceSlug,
  slugArg,
  withMultiRootSuffix,
  REPO_TOOL_HINT,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitStatus = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootSuffix('Git status', ctx, REPO_TOOL_HINT),
    inputSchema: z.object({
      ...repoSlugFields(ctx),
    }),
    execute: async (input) => {
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      return gitStatusCommand(resolved.projectRoot, ipcProjectRoots(ctx))
    },
  })

export default gitStatus
