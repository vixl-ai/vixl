import type { GitStatusResult } from '@/types/git/git-status-result'
import { call } from './helpers'
import type { GitCommitResult } from './types'

export const gitStatus = (projectRoot: string): Promise<GitStatusResult> =>
  call('git_status', { projectRoot })

export const gitDiff = (args: {
  projectRoot: string
  path?: string
  staged?: boolean
}): Promise<{ diff: string }> => call('git_diff', args)

export const gitShowFile = (args: {
  projectRoot: string
  path: string
}): Promise<{ content: string; exists: boolean }> =>
  call('git_show_file', args)

export const gitLog = (
  projectRoot: string,
  limit?: number,
): Promise<{ commits: Array<{ hash: string; subject: string }> }> =>
  call('git_log', { projectRoot, limit })

export const gitListBranches = (projectRoot: string): Promise<string[]> =>
  call('git_list_branches', { rootPath: projectRoot })

export const gitCheckoutBranch = (projectRoot: string, branch: string): Promise<void> =>
  call('git_checkout_branch', { rootPath: projectRoot, branch })

export const gitCommit = (args: {
  projectRoot: string
  message: string
  paths: string[]
}): Promise<GitCommitResult> => call('git_commit', args)

export const gitBranchCreate = (args: {
  projectRoot: string
  name: string
  checkout?: boolean
}): Promise<void> => call('git_branch_create', args)
