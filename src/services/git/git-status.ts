import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/services/vixl/vixl-tauri'
import type { GitStatusResult } from '@/types/git/git-status-result'

export default async (projectRoot: string): Promise<GitStatusResult> => {
  if (!isTauri()) {
    return { branch: null, entries: [] }
  }
  return invoke<GitStatusResult>('git_status', { projectRoot })
}
