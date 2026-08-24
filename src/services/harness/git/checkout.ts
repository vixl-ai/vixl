import { tool } from 'ai'
import { z } from 'zod'
import { gitCheckoutBranch } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitCheckout = (ctx: HarnessToolContext) =>
  tool({
    description: 'Checkout a git branch or ref',
    inputSchema: z.object({ branch: z.string() }),
    execute: async ({ branch }, { toolCallId }) => {
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'git_checkout',
        kind: 'git',
        action: 'git.write',
        capability: 'git.checkout',
        title: `git checkout ${branch}`,
      })
      if (!allowed) {
        return { rejected: true, error: 'Git checkout denied' }
      }
      await gitCheckoutBranch(ctx.projectRoot, branch)
      return { branch, checkedOut: true }
    },
  })

export default gitCheckout
