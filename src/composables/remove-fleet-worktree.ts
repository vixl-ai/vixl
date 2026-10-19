import { refreshFleetProjects } from '@/composables/use-fleet-registry'
import { activeSubagentsForWorkspace } from '@/services/harness/subagent/active-for-workspace'
import {
  gitStatus,
  gitWorktreeRemove,
  listChats,
  registryRemoveProject,
} from '@/services/vixl/vixl-tauri'
import invokeErrorMessage from '@/utils/invoke-error-message'

export type WorktreeRemovePreview = {
  branch: string
  dirty: boolean
  dirtyLabel: 'yes' | 'no' | 'unknown'
  chatCount: number
  runningCount: number
  activeSubagentCount: number
}

export type ConfirmRemoveWorktreeResult =
  | { ok: true; warning?: string }
  | { ok: false; reason: 'running' | 'error'; message: string }

export const loadWorktreeRemovePreview = async (args: {
  slug: string
  rootPath: string
  branch: string
}): Promise<WorktreeRemovePreview> => {
  const chats = await listChats(args.slug)
  const runningCount = chats.filter((chat) => chat.status === 'running').length
  const activeSubagentCount = activeSubagentsForWorkspace(
    args.slug,
    args.rootPath,
  ).length
  let dirty = false
  let dirtyLabel: WorktreeRemovePreview['dirtyLabel'] = 'unknown'
  try {
    const status = await gitStatus(args.rootPath)
    dirty = status.entries.some((entry) => !entry.isIgnored)
    dirtyLabel = dirty ? 'yes' : 'no'
  } catch {
    dirty = false
    dirtyLabel = 'unknown'
  }

  return {
    branch: args.branch,
    dirty,
    dirtyLabel,
    chatCount: chats.length,
    runningCount,
    activeSubagentCount,
  }
}

export const confirmRemoveWorktree = async (args: {
  projectId: string
  slug: string
  parentRoot: string
  worktreeRoot: string
  force: boolean
}): Promise<ConfirmRemoveWorktreeResult> => {
  const chats = await listChats(args.slug)
  const runningCount = chats.filter((chat) => chat.status === 'running').length
  if (runningCount > 0) {
    return {
      ok: false,
      reason: 'running',
      message: `Cannot remove worktree while ${runningCount} chat(s) are running on ${args.slug}`,
    }
  }

  const activeImplementers = activeSubagentsForWorkspace(
    args.slug,
    args.worktreeRoot,
  )
  if (activeImplementers.length > 0) {
    return {
      ok: false,
      reason: 'running',
      message: `Cannot remove worktree while ${activeImplementers.length} active implementer(s) are running on ${args.slug}`,
    }
  }

  try {
    await gitWorktreeRemove(args.parentRoot, args.worktreeRoot, args.force)
  } catch (error) {
    const message = invokeErrorMessage(error)
    if (!message.includes('not a worktree')) {
      return { ok: false, reason: 'error', message }
    }
  }

  try {
    await registryRemoveProject(args.projectId)
    await refreshFleetProjects()
  } catch {
    const warning = 'Checkout is gone. Remove the row from the sidebar if it lingers.'
    try {
      await refreshFleetProjects()
    } catch {
      return { ok: true, warning }
    }
    return { ok: true, warning }
  }

  return { ok: true }
}
