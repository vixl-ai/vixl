import { tool } from 'ai'
import { z } from 'zod'
import { gitBranchCreate as gitBranchCreateCommand } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitBranchCreate = (ctx: HarnessToolContext) =>
  tool({
    description: 'Create a new git branch',
    inputSchema: z.object({
      name: z.string(),
      checkout: z.boolean().optional(),
    }),
    execute: async ({ name, checkout }, { toolCallId }) => {
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'git_branch_create',
        kind: 'git',
        action: 'git.write',
        capability: 'git.branch_create',
        title: `git branch ${name}`,
      })
      if (!allowed) {
        return { rejected: true, error: 'Git branch create denied' }
      }
      await gitBranchCreateCommand({
        projectRoot: ctx.projectRoot,
        name,
        checkout,
      })
      return { name, checkout: checkout ?? true }
    },
  })

export default gitBranchCreate
