import { homeDir } from '@tauri-apps/api/path'
import { isTauri } from './helpers'

export const getUserHomeDir = (): Promise<string> => {
  if (!isTauri()) {
    return Promise.reject(
      new Error('Vixl desktop APIs are only available in the Tauri app'),
    )
  }
  return homeDir()
}
