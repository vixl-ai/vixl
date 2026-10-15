import { tool } from 'ai'
import { z } from 'zod'
import { gitDiff as gitDiffCommand } from '@/services/vixl/vixl-tauri'
import {
  repoSlugFields,
  resolveWorkspaceSlug,
  slugArg,
  withMultiRootPathHint,
  withMultiRootSuffix,
  withProjectRoots,
  REPO_TOOL_HINT,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitDiff = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootSuffix(
      withMultiRootPathHint('Git diff. Default unstaged (working tree vs index)', ctx),
      ctx,
      REPO_TOOL_HINT,
    ),
    inputSchema: z.object({
      path: z.string().optional().describe(withMultiRootPathHint('Optional path', ctx)),
      staged: z
        .boolean()
        .optional()
        .describe('Diff index instead of working tree; vs HEAD if no base'),
      base: z
        .string()
        .optional()
        .describe('Ref or range, e.g. HEAD (all uncommitted) or main...HEAD (branch)'),
      ...repoSlugFields(ctx),
    }),
    execute: async (input) => {
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      return gitDiffCommand(
        withProjectRoots(
          {
            projectRoot: resolved.projectRoot,
            path: input.path,
            staged: input.staged,
            base: input.base,
          },
          ctx,
        ),
      )
    },
  })

export default gitDiff
