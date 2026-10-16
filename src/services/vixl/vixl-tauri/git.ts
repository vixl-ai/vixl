import type { GitHeadChanged } from '@/types/git/git-head-changed'
import type { GitStatusResult } from '@/types/git/git-status-result'
import { call } from './helpers'
import type { GitCommitResult, IpcProjectRoot } from './types'

export type { GitHeadChanged }

export const watchGitHead = (rootPath?: string | null): Promise<void> =>
  call('watch_git_head', { rootPath: rootPath ?? null })

export const gitStatus = (
  projectRoot: string,
  projectRoots?: IpcProjectRoot[],
): Promise<GitStatusResult> =>
  call('git_status', {
    projectRoot,
    ...(projectRoots ? { projectRoots } : {}),
  })

export const gitDiff = (args: {
  projectRoot: string
  path?: string
  staged?: boolean
  base?: string
  projectRoots?: IpcProjectRoot[]
}): Promise<{ diff: string }> => call('git_diff', args)

export const gitShowFile = (args: {
  projectRoot: string
  path: string
  projectRoots?: IpcProjectRoot[]
}): Promise<{ content: string; exists: boolean }> =>
  call('git_show_file', args)

export const gitLog = (
  projectRoot: string,
  limit?: number,
  projectRoots?: IpcProjectRoot[],
): Promise<{ commits: Array<{ hash: string; subject: string }> }> =>
  call('git_log', {
    projectRoot,
    limit,
    ...(projectRoots ? { projectRoots } : {}),
  })

export const gitListBranches = (
  projectRoot: string,
  projectRoots?: IpcProjectRoot[],
): Promise<string[]> =>
  call('git_list_branches', {
    rootPath: projectRoot,
    ...(projectRoots ? { projectRoots } : {}),
  })

export const gitCheckoutBranch = (
  projectRoot: string,
  branch: string,
  projectRoots?: IpcProjectRoot[],
): Promise<void> =>
  call('git_checkout_branch', {
    rootPath: projectRoot,
    branch,
    ...(projectRoots ? { projectRoots } : {}),
  })

export const gitCommit = (args: {
  projectRoot: string
  message: string
  paths: string[]
  projectRoots?: IpcProjectRoot[]
}): Promise<GitCommitResult> => call('git_commit', args)

export const gitBranchCreate = (args: {
  projectRoot: string
  name: string
  checkout?: boolean
  projectRoots?: IpcProjectRoot[]
}): Promise<void> => call('git_branch_create', args)
