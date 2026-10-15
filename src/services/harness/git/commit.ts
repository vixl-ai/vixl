import { tool } from 'ai'
import { z } from 'zod'
import { gitCommit as gitCommitCommand } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import {
  isMultiRootWorkspace,
  repoSlugFields,
  resolveWorkspaceSlug,
  slugArg,
  withMultiRootPathHint,
  withProjectRoots,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitCommit = (ctx: HarnessToolContext) =>
  tool({
    description: isMultiRootWorkspace(ctx)
      ? withMultiRootPathHint(
          'Stage paths and commit with a message. One repo per commit: all paths must belong to a single project member.',
          ctx,
        )
      : 'Stage paths and commit with a message',
    inputSchema: z.object({
      message: z.string().describe('Commit message'),
      paths: z
        .array(z.string())
        .min(1)
        .describe(
          isMultiRootWorkspace(ctx)
            ? withMultiRootPathHint('Paths to stage. One repo per commit.', ctx)
            : 'Paths to stage',
        ),
      ...repoSlugFields(ctx),
    }),
    execute: async (input, { toolCallId }) => {
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'git_commit',
        kind: 'git',
        action: 'git.write',
        capability: 'git.commit',
        title: `git commit: ${input.message}`,
      })
      if (!allowed) {
        return { rejected: true, error: 'Git commit denied' }
      }
      return gitCommitCommand(
        withProjectRoots(
          {
            projectRoot: resolved.projectRoot,
            message: input.message,
            paths: input.paths,
          },
          ctx,
        ),
      )
    },
  })

export default gitCommit
