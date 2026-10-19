import { tool } from 'ai'
import { z } from 'zod'
import { refreshFleetProjects } from '@/composables/use-fleet-registry'
import { isHomeChatSlug } from '@/constants/home-chat'
import ensureCodeGraph from '@/services/codegraph/ensure-codegraph'
import { isHomeWorkspaceRoot } from '@/services/config/is-home-workspace-root'
import { gateWorkspaceMovePermission } from '@/services/harness/permission'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import {
  gitWorktreeAdd,
  gitWorktreeRemove,
  registryAddProject,
} from '@/services/vixl/vixl-tauri'
import invokeErrorMessage from '@/utils/invoke-error-message'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const WORKTREE_NAME_RE = /^[a-z0-9-]+$/

const warmCodeGraph = async (root: string): Promise<void> => {
  try {
    await ensureCodeGraph(root)
  } catch {
    return
  }
}

const worktreeCreate = (ctx: HarnessToolContext) =>
  tool({
    description: 'Create a git worktree (always user-approved).',
    inputSchema: z.object({
      name: z.string().describe('Lowercase slug (branch vixl/<name>)'),
      baseRef: z.string().optional().describe('Base git ref'),
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
      } catch (error) {
        let rollbackNote = `Removed the checkout; delete branch ${created.branch} before retrying`
        try {
          await gitWorktreeRemove(ctx.projectRoot, created.path, true)
        } catch (rollbackError) {
          rollbackNote = `Rollback failed: ${invokeErrorMessage(rollbackError)}. Delete worktree ${created.path} and branch ${created.branch} before retrying`
        }
        return {
          error: `Worktree created at ${created.path} but registration failed: ${invokeErrorMessage(error)}. ${rollbackNote}.`,
        }
      }
      let message =
        'Worktree created and registered. Call move_workspace with this rootPath if the current chat should continue inside it, or pass this slug as workspaceSlug to spawn_subagent for an isolated implementer.'
      try {
        await refreshFleetProjects()
      } catch {
        message = `${message} Sidebar may need a reload.`
      }

      void warmCodeGraph(created.path)

      return {
        ok: true,
        slug,
        rootPath: created.path,
        branch: created.branch,
        message,
      }
    },
  })

export default worktreeCreate
