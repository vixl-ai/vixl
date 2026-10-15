import { tool } from 'ai'
import { z } from 'zod'
import gitRepoInfo from '@/services/git/git-repo-info'
import {
  repoSlugFields,
  resolveWorkspaceSlug,
  slugArg,
  withMultiRootSuffix,
  REPO_TOOL_HINT,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitBranch = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootSuffix('Current git branch', ctx, REPO_TOOL_HINT),
    inputSchema: z.object({
      ...repoSlugFields(ctx),
    }),
    execute: async (input) => {
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      return gitRepoInfo(resolved.projectRoot)
    },
  })

export default gitBranch
