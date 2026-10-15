import { tool } from 'ai'
import { z } from 'zod'
import { gitCheckoutBranch } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import {
  ipcProjectRoots,
  repoSlugFields,
  resolveWorkspaceSlug,
  slugArg,
  withMultiRootSuffix,
  REPO_TOOL_HINT,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitCheckout = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootSuffix('Checkout a git branch or ref', ctx, REPO_TOOL_HINT),
    inputSchema: z.object({
      branch: z.string().describe('Branch or ref'),
      ...repoSlugFields(ctx),
    }),
    execute: async (input, { toolCallId }) => {
      const resolved = resolveWorkspaceSlug(ctx, slugArg(input, 'repo'))
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'git_checkout',
        kind: 'git',
        action: 'git.write',
        capability: 'git.checkout',
        title: `git checkout ${input.branch}`,
      })
      if (!allowed) {
        return { rejected: true, error: 'Git checkout denied' }
      }
      await gitCheckoutBranch(resolved.projectRoot, input.branch, ipcProjectRoots(ctx))
      return {
        branch: input.branch,
        checkedOut: true,
        ...(resolved.slug ? { repo: resolved.slug } : {}),
      }
    },
  })

export default gitCheckout
