import { call } from './helpers'

export type GitWorktreeEntry = {
  path: string
  branch: string | null
  bare: boolean
  detached: boolean
}

export type GitWorktreeAddResult = {
  path: string
  branch: string
  name: string
}

export type WorktreeParentMatch = {
  parentProjectId: string
  branch: string
}

export const gitWorktreeList = (rootPath: string): Promise<GitWorktreeEntry[]> =>
  call('git_worktree_list', { rootPath })

export const gitWorktreeAdd = (
  rootPath: string,
  name: string,
  baseRef?: string,
): Promise<GitWorktreeAddResult> =>
  call('git_worktree_add', {
    rootPath,
    name,
    ...(baseRef !== undefined ? { baseRef } : {}),
  })

export const gitWorktreeRemove = (
  rootPath: string,
  worktreePath: string,
  force: boolean,
): Promise<void> => call('git_worktree_remove', { rootPath, worktreePath, force })

export const worktreeDetectParent = (path: string): Promise<WorktreeParentMatch | null> =>
  call('worktree_detect_parent', { path })
