import { invoke } from '@tauri-apps/api/core'
import isVibrancySupported from './supported'

const clearWindowVibrancy = async (): Promise<void> => {
  if (!isVibrancySupported()) {
    return
  }

  await invoke('clear_window_vibrancy')
}

export default clearWindowVibrancy
