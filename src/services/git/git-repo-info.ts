import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/services/vixl/vixl-tauri'
import type { GitRepoInfo } from '@/types/git/git-repo-info'

export default async (rootPath: string): Promise<GitRepoInfo> => {
  if (!isTauri()) {
    return { isRepo: false, currentBranch: null }
  }
  return invoke<GitRepoInfo>('git_repo_info', { rootPath })
}
