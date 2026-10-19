import { tool } from 'ai'
import { z } from 'zod'
import {
  ensureFleetLoaded,
  getFleetProjects,
  refreshFleetProjects,
} from '@/composables/use-fleet-registry'
import { gateWorkspaceMovePermission } from '@/services/harness/permission'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import { activeSubagentsForWorkspace } from '@/services/harness/subagent/active-for-workspace'
import {
  gitStatus,
  gitWorktreeList,
  gitWorktreeRemove,
  listChats,
  registryRemoveProject,
  worktreeDetectParent,
  type ChatMetaRecord,
  type GitWorktreeEntry,
} from '@/services/vixl/vixl-tauri'
import invokeErrorMessage from '@/utils/invoke-error-message'
import { pathsEqualCanonical } from '@/utils/paths-equal'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const occupancyError = (
  slug: string,
  chats: ChatMetaRecord[],
  targetPath: string,
): string | null => {
  const runningCount = chats.filter((chat) => chat.status === 'running').length
  if (runningCount > 0) {
    return `Cannot remove worktree while ${runningCount} chat(s) are running on ${slug}`
  }
  const activeCount = activeSubagentsForWorkspace(slug, targetPath).length
  if (activeCount > 0) {
    return `Cannot remove worktree while ${activeCount} active implementer(s) are running on ${slug}`
  }
  return null
}

const UNREGISTER_WARNING =
  'Checkout is gone. Remove the row from the sidebar if it lingers.'

const projectForRoot = (
  projects: FleetProject[],
  rootPath: string,
): FleetProject | undefined =>
  projects.find((entry) => pathsEqualCanonical(entry.rootPath, rootPath))

const resolveFleetProject = async (
  projects: FleetProject[],
  targetPath: string,
  projectRoot: string,
): Promise<FleetProject | undefined> => {
  const direct = projectForRoot(projects, targetPath)
  if (direct) {
    return direct
  }

  let entries: GitWorktreeEntry[] = []
  try {
    entries = await gitWorktreeList(projectRoot)
  } catch {
    return undefined
  }

  const reported = entries.find((entry) => pathsEqualCanonical(entry.path, targetPath))
  if (!reported) {
    return undefined
  }
  return projectForRoot(projects, reported.path)
}

const worktreeRemove = (ctx: HarnessToolContext) =>
  tool({
    description: 'Remove a git worktree (always user-approved).',
    inputSchema: z.object({
      rootPath: z.string().optional().describe('Worktree path (not this chat root)'),
      force: z.boolean().optional().describe('Force even if dirty (implied when Dirty: yes)'),
    }),
    execute: async ({ rootPath, force }, { toolCallId }) => {
      if (ctx.subagentId) {
        return { error: 'worktree_remove can only run on the parent chat' }
      }

      const targetPath = (rootPath ?? ctx.projectRoot).trim()
      if (!targetPath) {
        return { error: 'rootPath is required' }
      }
      if (pathsEqualCanonical(targetPath, ctx.projectRoot)) {
        return {
          error:
            'worktree_remove cannot remove the current chat workspace; pass a different rootPath',
        }
      }

      await ensureFleetLoaded()
      const projects = getFleetProjects()
      const project = await resolveFleetProject(projects, targetPath, ctx.projectRoot)
      if (!project) {
        return { error: 'No fleet project matches that worktree path' }
      }
      const worktreePath = project.rootPath

      let parentRoot: string | undefined
      if (project.worktree?.parentId) {
        parentRoot = projects.find((entry) => entry.id === project.worktree?.parentId)?.rootPath
      }
      if (!parentRoot) {
        try {
          const detected = await worktreeDetectParent(worktreePath)
          if (detected) {
            parentRoot = projects.find((entry) => entry.id === detected.parentProjectId)?.rootPath
          }
        } catch {
          parentRoot = undefined
        }
      }
      const gitRoot = parentRoot ?? worktreePath

      const chats = await listChats(project.slug)
      const preBusy = occupancyError(project.slug, chats, worktreePath)
      if (preBusy) {
        return { error: preBusy }
      }

      const branch = project.worktree?.branch ?? 'unknown'
      let dirty: boolean | null = null
      try {
        const status = await gitStatus(worktreePath)
        dirty = status.entries.some((entry) => !entry.isIgnored)
      } catch {
        dirty = null
      }
      const dirtyLabel = dirty === null ? 'unknown' : dirty ? 'yes' : 'no'

      const detail = [
        `Path: ${targetPath}`,
        `Branch: ${branch}`,
        `Dirty: ${dirtyLabel}`,
        `Chats: ${chats.length}`,
      ].join('\n')

      const allowed = await gateWorkspaceMovePermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'worktree_remove',
        title: `Remove worktree ${branch}?`,
        detail,
      })
      if (!allowed) {
        return { rejected: true, error: 'User declined removing the worktree' }
      }

      const latestChats = await listChats(project.slug)
      const postBusy = occupancyError(project.slug, latestChats, worktreePath)
      if (postBusy) {
        return { error: postBusy }
      }

      const effectiveForce = force === true || dirty === true
      try {
        await gitWorktreeRemove(gitRoot, worktreePath, effectiveForce)
      } catch (error) {
        const message = invokeErrorMessage(error)
        if (!message.includes('not a worktree')) {
          return { error: message }
        }
      }

      try {
        await registryRemoveProject(project.id)
        await refreshFleetProjects()
      } catch {
        try {
          await refreshFleetProjects()
        } catch {
          return {
            ok: true,
            warning: UNREGISTER_WARNING,
            message: `Removed worktree ${branch} at ${targetPath}. ${UNREGISTER_WARNING}`,
          }
        }
        return {
          ok: true,
          warning: UNREGISTER_WARNING,
          message: `Removed worktree ${branch} at ${targetPath}. ${UNREGISTER_WARNING}`,
        }
      }

      return {
        ok: true,
        message: `Removed worktree ${branch} at ${targetPath} and unregistered it from the fleet.`,
      }
    },
  })

export default worktreeRemove
