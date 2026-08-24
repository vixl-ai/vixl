import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/services/vixl/vixl-tauri'

export default async (rootPath: string, branch: string): Promise<void> => {
  if (!isTauri()) {
    throw new Error('Git commands are only available in the Tauri app')
  }
  await invoke('git_checkout_branch', { rootPath, branch })
}
