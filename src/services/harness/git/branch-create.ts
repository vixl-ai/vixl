import { tool } from 'ai'
import { z } from 'zod'
import { gitBranchCreate as gitBranchCreateCommand } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import {
  repoSlugFields,
  resolveWorkspaceSlug,
  slugArg,
  withMultiRootSuffix,
  withProjectRoots,
  REPO_TOOL_HINT,
} from '@/services/harness/tool-roots'
import { withGitRepoGuard } from '@/services/harness/git/with-git-repo-guard'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitBranchCreate = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootSuffix('Create a new git branch', ctx, REPO_TOOL_HINT),
    inputSchema: z.object({
      name: z.string().describe('New branch name'),
      checkout: z.boolean().optional().describe('Checkout after create'),
      ...repoSlugFields(ctx),
    }),
    execute: async (input, { toolCallId }) => {
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'git_branch_create',
        kind: 'git',
        action: 'git.write',
        capability: 'git.branch_create',
        title: `git branch ${input.name}`,
      })
      if (!allowed) {
        return { rejected: true, error: 'Git branch create denied' }
      }
      return withGitRepoGuard(async () => {
        await gitBranchCreateCommand(
          withProjectRoots(
            {
              projectRoot: resolved.projectRoot,
              name: input.name,
              checkout: input.checkout,
            },
            ctx,
          ),
        )
        return {
          name: input.name,
          checkout: input.checkout ?? true,
          ...(resolved.slug ? { repo: resolved.slug } : {}),
        }
      })
    },
  })

export default gitBranchCreate
