import { invoke } from '@tauri-apps/api/core'
import { toast } from 'vue-sonner'
import formatUnknownError from '@/utils/format-unknown-error'

const transparencyEnabled = ref(false)
let lifecycleRegistered = false
let previewErrorShown = false

export default () => {
  const config = useVixlConfig()
  const mode = useColorMode()

  const isLinux = (): boolean =>
    typeof navigator !== 'undefined' &&
    navigator.userAgent.toLowerCase().includes('linux')

  const syncTransparency = async (): Promise<void> => {
    if (isLinux()) {
      return
    }

    const enabled =
      config.hydrated.value &&
      config.effectiveSettings.value['appearance.transparency'] !== false

    if (!enabled) {
      document.documentElement.classList.remove('transparency-on')
      transparencyEnabled.value = false
      try {
        await invoke('clear_window_vibrancy')
      } catch (error) {
        toast.error('Failed to disable window transparency', {
          description: formatUnknownError(error),
        })
      }
      return
    }

    const isDark = mode.state.value === 'dark'
    const hue = config.effectiveSettings.value['appearance.transparencyHue'] ?? 265
    const intensity =
      config.effectiveSettings.value['appearance.transparencyIntensity'] ?? 0
    try {
      await invoke('set_window_vibrancy', { dark: isDark, hue, intensity })
      document.documentElement.classList.add('transparency-on')
      transparencyEnabled.value = true
    } catch (error) {
      toast.error('Failed to apply window transparency', {
        description: formatUnknownError(error),
      })
    }
  }

  const previewTransparency = (hue: number, intensity: number): void => {
    if (isLinux() || !transparencyEnabled.value) {
      return
    }

    invoke('set_window_vibrancy', {
      dark: mode.state.value === 'dark',
      hue,
      intensity,
    }).catch((error: unknown) => {
      if (previewErrorShown) {
        return
      }
      previewErrorShown = true
      toast.error('Failed to preview window transparency', {
        description: formatUnknownError(error),
      })
    })
  }

  if (!lifecycleRegistered) {
    lifecycleRegistered = true

    watch(
      [
        () => config.effectiveSettings.value['appearance.transparency'],
        () => config.effectiveSettings.value['appearance.transparencyHue'],
        () => config.effectiveSettings.value['appearance.transparencyIntensity'],
        config.hydrated,
        mode,
        () => mode.state.value,
      ],
      () => {
        syncTransparency().catch((error: unknown) => {
          toast.error('Failed to apply window transparency', {
            description: formatUnknownError(error),
          })
        })
      },
    )

    onMounted(() => {
      syncTransparency().catch((error: unknown) => {
        toast.error('Failed to apply window transparency', {
          description: formatUnknownError(error),
        })
      })
    })
  }

  return { transparencyEnabled, previewTransparency }
}
