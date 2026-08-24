import { tool } from 'ai'
import { z } from 'zod'
import { gitCommit as gitCommitCommand } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitCommit = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Stage specific paths and commit with a message. paths is required — use git_status to identify changed files before committing.',
    inputSchema: z.object({
      message: z.string(),
      paths: z.array(z.string()).min(1),
    }),
    execute: async ({ message, paths }, { toolCallId }) => {
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'git_commit',
        kind: 'git',
        action: 'git.write',
        capability: 'git.commit',
        title: `git commit: ${message}`,
      })
      if (!allowed) {
        return { rejected: true, error: 'Git commit denied' }
      }
      return gitCommitCommand({
        projectRoot: ctx.projectRoot,
        message,
        paths,
      })
    },
  })

export default gitCommit
