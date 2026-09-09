import { computed } from 'vue'
import useVixlConfig from '@/composables/use-vixl-config'
import {
  resolveActiveTheme,
  resolveActiveCustomTheme,
  resolveCollisionSafeThemeId,
  sanitizeThemeLibrary,
  slugifyThemeName,
} from '@/services/appearance/theme-library'
import { parseThemeDefinition } from '@/schemas/appearance/theme'
import {
  BUILTIN_VIXL_THEME_ID,
  VIXL_THEME_FORMAT_VERSION,
  type VixlThemeDefinition,
} from '@/types/appearance/theme'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import { isReservedThemeId } from '@/constants/appearance/built-in-theme-registry'

/**
 * Personal theme library bound to Vixl personal settings.
 *
 * `appearance.themeLibrary` holds the saved themes and
 * `appearance.activeThemeId` the active custom theme (built-in fallback when
 * missing/dangling). Both keys are personal-only in the config layer.
 */
export const useAppearanceThemes = () => {
  const config = useVixlConfig()

  const themes = computed(() =>
    sanitizeThemeLibrary(config.effectiveSettings.value['appearance.themeLibrary']),
  )

  const activeCustomTheme = computed(() =>
    resolveActiveCustomTheme(
      themes.value,
      config.effectiveSettings.value['appearance.activeThemeId'],
    ),
  )

  // Curated bundled themes resolve by stored id even though they never live
  // in the personal library; null falls back to the built-in default.
  const activeTheme = computed<VixlThemeDefinition>(
    () =>
      resolveActiveTheme(
        themes.value,
        config.effectiveSettings.value['appearance.activeThemeId'],
      ) ?? builtInVixlTheme,
  )

  const isBuiltInActive = computed(() => activeCustomTheme.value === null)

  const selectedThemeId = computed<string>(() => activeTheme.value.id)

  /** Persisted theme ids currently in the library. */
  const existingIds = computed(() => themes.value.map((theme) => theme.id))

  /**
   * Generates a collision-safe id from a display name. The name is preserved;
   * only the slug id is rewritten on collision.
   */
  const generateThemeId = (name: string, taken: readonly string[] = existingIds.value): string =>
    resolveCollisionSafeThemeId(slugifyThemeName(name), taken)

  /** Saves (insert or replace) a theme via personal settings. */
  const saveTheme = async (
    theme: VixlThemeDefinition,
    options: { activate?: boolean } = {},
  ): Promise<boolean> => {
    if (isReservedThemeId(theme.id)) {
      return false
    }
    const parsed = parseThemeDefinition(theme)
    if (!parsed.success) {
      return false
    }
    const current = themes.value
    const index = current.findIndex((entry) => entry.id === parsed.data.id)
    const next =
      index >= 0
        ? current.map((entry, entryIndex) => (entryIndex === index ? parsed.data : entry))
        : [...current, parsed.data]
    try {
      await config.updateSetting('personal', 'appearance.themeLibrary', next)
      if (options.activate) {
        await config.updateSetting('personal', 'appearance.activeThemeId', parsed.data.id)
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * Removes a theme. Deleting the active theme atomically falls back to the
   * built-in default by clearing the active id in the same settings write.
   */
  const removeTheme = async (id: string): Promise<boolean> => {
    if (isReservedThemeId(id)) {
      return false
    }
    const current = themes.value
    const next = current.filter((theme) => theme.id !== id)
    if (next.length === current.length) {
      return false
    }
    try {
      await config.updateSetting('personal', 'appearance.themeLibrary', next)
      if (config.effectiveSettings.value['appearance.activeThemeId'] === id) {
        await config.updateSetting('personal', 'appearance.activeThemeId', undefined)
      }
      return true
    } catch {
      return false
    }
  }

  /** Renames a saved theme, preserving its id. */
  const renameTheme = async (id: string, name: string): Promise<boolean> => {
    const theme = themes.value.find((entry) => entry.id === id)
    if (!theme || isReservedThemeId(theme.id)) {
      return false
    }
    return saveTheme({ ...theme, name, version: VIXL_THEME_FORMAT_VERSION })
  }

  /**
   * Selects a theme: library entries and curated bundled ids persist by id;
   * the built-in default (or unknown) clears the stored id.
   */
  const setActiveTheme = async (id: string | null): Promise<void> => {
    const selectable =
      id !== null &&
      id !== BUILTIN_VIXL_THEME_ID &&
      (themes.value.some((theme) => theme.id === id) || isReservedThemeId(id))
    const value = selectable ? id : undefined
    await config.updateSetting('personal', 'appearance.activeThemeId', value)
  }

  return {
    themes,
    activeTheme,
    activeCustomTheme,
    isBuiltInActive,
    selectedThemeId,
    existingIds,
    generateThemeId,
    saveTheme,
    removeTheme,
    renameTheme,
    setActiveTheme,
  }
}
