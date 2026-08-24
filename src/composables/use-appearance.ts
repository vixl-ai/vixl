import { useColorMode } from '@vueuse/core'
import { onMounted, watch } from 'vue'
import useVixlConfig from '@/composables/use-vixl-config'

export default () => {
  const mode = useColorMode()
  const config = useVixlConfig()

  const syncTheme = (): void => {
    const theme = config.effectiveSettings.value['appearance.theme'] ?? 'system'
    if (theme === 'system') {
      mode.value = 'auto'
      return
    }
    mode.value = theme
  }

  watch(
    () => [
      config.effectiveSettings.value['appearance.theme'],
      config.hydrated.value,
    ],
    () => {
      if (config.hydrated.value) {
        syncTheme()
      }
    },
    { deep: true },
  )

  onMounted(() => {
    if (config.hydrated.value) {
      syncTheme()
    }
  })

  return { syncTheme }
}
