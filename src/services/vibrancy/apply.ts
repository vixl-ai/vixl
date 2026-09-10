import { invoke } from '@tauri-apps/api/core'
import isVibrancySupported from './supported'

const applyWindowVibrancy = async (options: {
  dark: boolean
  hue: number
  intensity: number
}): Promise<void> => {
  if (!isVibrancySupported()) {
    return
  }

  await invoke('set_window_vibrancy', options)
}

export default applyWindowVibrancy
