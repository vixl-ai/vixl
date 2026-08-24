import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/services/vixl/vixl-tauri'

export default async (rootPath: string): Promise<string[]> => {
  if (!isTauri()) {
    return []
  }
  return invoke<string[]>('git_list_branches', { rootPath })
}
