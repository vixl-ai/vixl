import { refreshFleetProjects } from '@/composables/use-fleet-registry'
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
}

export type ConfirmRemoveWorktreeResult =
  | { ok: true }
  | { ok: false; reason: 'running' | 'error'; message: string }

export const loadWorktreeRemovePreview = async (args: {
  slug: string
  rootPath: string
  branch: string
}): Promise<WorktreeRemovePreview> => {
  const chats = await listChats(args.slug)
  const runningCount = chats.filter((chat) => chat.status === 'running').length
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

  try {
    await gitWorktreeRemove(args.parentRoot, args.worktreeRoot, args.force)
  } catch (error) {
    return { ok: false, reason: 'error', message: invokeErrorMessage(error) }
  }

  try {
    await registryRemoveProject(args.projectId)
    await refreshFleetProjects()
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: `Worktree git remove succeeded but fleet unregister failed: ${invokeErrorMessage(error)}`,
    }
  }

  return { ok: true }
}
