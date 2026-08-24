import { computed, onMounted, ref } from 'vue'

const storageKey = 'vixl-marketing-theme'

export default () => {
  const theme = ref<'dark' | 'light'>('dark')
  const isDark = computed(() => theme.value === 'dark')

  const persistTheme = (): void => {
    localStorage.setItem(storageKey, theme.value)
  }

  const toggleTheme = (): void => {
    theme.value = isDark.value ? 'light' : 'dark'
    persistTheme()
  }

  onMounted(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored === 'light' || stored === 'dark') {
      theme.value = stored
    }
  })

  return {
    isDark,
    toggleTheme,
  }
}
