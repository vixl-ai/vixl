import { tool } from 'ai'
import { z } from 'zod'
import { refreshFleetProjects } from '@/composables/use-fleet-registry'
import { isHomeChatSlug } from '@/constants/home-chat'
import ensureCodeGraph from '@/services/codegraph/ensure-codegraph'
import { isHomeWorkspaceRoot } from '@/services/config/is-home-workspace-root'
import { gateWorkspaceMovePermission } from '@/services/harness/permission'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import { gitWorktreeAdd, registryAddProject } from '@/services/vixl/vixl-tauri'
import invokeErrorMessage from '@/utils/invoke-error-message'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const WORKTREE_NAME_RE = /^[a-z0-9-]+$/

const worktreeCreate = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Create a git worktree as a fleet sub-project (always user-approved). Does not move this chat.',
    inputSchema: z.object({
      name: z
        .string()
        .describe('Lowercase slug for the worktree and branch vixl/<name>'),
      baseRef: z
        .string()
        .optional()
        .describe('Git ref to base the new branch on (default HEAD)'),
    }),
    execute: async ({ name, baseRef }, { toolCallId }) => {
      if (ctx.subagentId) {
        return { error: 'worktree_create can only run on the parent chat' }
      }

      const trimmed = name.trim()
      if (!WORKTREE_NAME_RE.test(trimmed)) {
        return { error: 'Worktree name must be a lowercase slug (a-z, 0-9, hyphen)' }
      }

      if (isHomeChatSlug(ctx.projectSlug) || (await isHomeWorkspaceRoot(ctx.projectRoot))) {
        return { error: 'worktree_create cannot run on the home project' }
      }

      const allowed = await gateWorkspaceMovePermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'worktree_create',
        title: `Create worktree vixl/${trimmed}?`,
        detail: ctx.projectRoot,
      })
      if (!allowed) {
        return { rejected: true, error: 'User declined creating the worktree' }
      }

      let created: { path: string; branch: string; name: string }
      try {
        created = await gitWorktreeAdd(ctx.projectRoot, trimmed, baseRef)
      } catch (error) {
        return { error: invokeErrorMessage(error) }
      }

      let slug = created.name
      try {
        const registered = await registryAddProject(created.name, created.path)
        slug = registered.slug
        await refreshFleetProjects()
      } catch (error) {
        return {
          error: `Worktree created at ${created.path} but registration failed: ${invokeErrorMessage(error)}`,
        }
      }

      void ensureCodeGraph(created.path).catch(() => undefined)

      return {
        ok: true,
        slug,
        rootPath: created.path,
        branch: created.branch,
        message:
          'Worktree created and registered. Call move_workspace with this rootPath if the current chat should continue inside it, or pass this slug as workspaceSlug to spawn_subagent for an isolated implementer.',
      }
    },
  })

export default worktreeCreate
