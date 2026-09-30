import { computed } from 'vue'
import { useColorMode, usePreferredDark } from '@vueuse/core'

const STORAGE_KEY = 'vuepress-color-scheme'

function syncDarkClass(resolved: string) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export function useLandingColorMode() {
  const preferredDark = usePreferredDark()

  const mode = useColorMode({
    attribute: 'data-theme',
    modes: {
      light: 'light',
      dark: 'dark',
    },
    storageKey: STORAGE_KEY,
    initialValue: 'auto',
    disableTransition: false,
    onChanged(value, defaultHandler) {
      defaultHandler(value)
      const resolved =
        value === 'auto'
          ? preferredDark.value
            ? 'dark'
            : 'light'
          : value
      syncDarkClass(resolved)
    },
  })

  const resolved = computed<'light' | 'dark'>(() => {
    if (mode.value === 'dark' || mode.value === 'light') return mode.value
    return preferredDark.value ? 'dark' : 'light'
  })

  function toggleTheme() {
    mode.value = resolved.value === 'dark' ? 'light' : 'dark'
  }

  return { mode, resolved, toggleTheme }
}
