import { THEME_LIBRARY_MAX_SIZE } from '@/schemas/appearance/theme'
import type { ThemeFilePayload } from '@/schemas/appearance/theme-file'
import type { VixlThemeDefinition } from '@/types/appearance/theme'
import { readSettings, writeSettings } from '@/services/vixl/vixl-tauri/config'
import {
  sanitizeThemeLibrary,
  themeFilePayloadToThemeDefinition,
} from './theme-library'
import { importThemeFromFile, ThemeFileError } from './theme-sharing'
import type { ThemeOperationResult } from './theme-sharing'

/**
 * Personal theme-library persistence.
 *
 * `appearance.themeLibrary` stores the runtime domain shape
 * (`VixlThemeDefinition`) — the same shape the Appearance editor saves — so
 * imported shareable files are converted before persistence. The imported
 * theme and its optional activation are written to the personal settings in
 * ONE atomic `write_settings` call; if the write fails, neither the library
 * nor the active theme changes. Dialog cancellation upstream is still a
 * no-op: nothing is read, built, or written.
 */

/** Settings keys for the personal-only theme library and active theme id. */
export const THEME_LIBRARY_SETTINGS_KEY = 'appearance.themeLibrary'
export const ACTIVE_THEME_SETTINGS_KEY = 'appearance.activeThemeId'

export type ThemeImportSettingsPatch = {
  'appearance.themeLibrary'?: VixlThemeDefinition[]
  'appearance.activeThemeId'?: string
}

/**
 * Build the settings patch for an import: the next personal theme library
 * (capped at the authoritative `THEME_LIBRARY_MAX_SIZE`) plus the optional
 * activation id. Pure — persistence is separate so the caller can write
 * library + activation in ONE atomic settings write.
 *
 * The current library is sanitized (invalid entries dropped, shareable-file
 * shape entries converted) so an import never silently drops themes that were
 * saved through the editor.
 */
export const buildThemeImportSettingsPatch = (options: {
  importedTheme: ThemeFilePayload
  currentLibrary: unknown
  activate?: boolean
}): ThemeImportSettingsPatch => {
  const library = sanitizeThemeLibrary(options.currentLibrary)

  if (library.length >= THEME_LIBRARY_MAX_SIZE) {
    throw new ThemeFileError(
      `Theme library is full (limit is ${THEME_LIBRARY_MAX_SIZE} themes)`,
    )
  }

  const patch: ThemeImportSettingsPatch = {
    [THEME_LIBRARY_SETTINGS_KEY]: [
      ...library,
      themeFilePayloadToThemeDefinition(options.importedTheme),
    ],
  }

  if (options.activate) {
    patch[ACTIVE_THEME_SETTINGS_KEY] = options.importedTheme.id
  }

  return patch
}

export type ThemePersistenceAdapter = {
  readPersonalSettings: () => Promise<Record<string, unknown>>
  writePersonalSettings: (settings: Record<string, unknown>) => Promise<void>
}

/** Default adapter reuses the existing personal settings.json IPC commands. */
export const defaultThemePersistenceAdapter: ThemePersistenceAdapter = {
  readPersonalSettings: () => readSettings('personal'),
  writePersonalSettings: (settings) => writeSettings('personal', settings),
}

export type PersistedThemeImport = {
  themeId: string
  library: VixlThemeDefinition[]
  activated: boolean
}

/**
 * Atomic personal persistence: merge the import patch into the current
 * personal settings and write everything in a single `write_settings` call.
 * If the write fails, neither the library nor the active theme changes.
 */
export const persistThemeImport = async (options: {
  importedTheme: ThemeFilePayload
  currentLibrary?: unknown
  activate?: boolean
  adapter?: ThemePersistenceAdapter
}): Promise<PersistedThemeImport> => {
  const adapter = options.adapter ?? defaultThemePersistenceAdapter

  const currentSettings = await adapter.readPersonalSettings()
  const patch = buildThemeImportSettingsPatch({
    importedTheme: options.importedTheme,
    currentLibrary: options.currentLibrary ?? currentSettings[THEME_LIBRARY_SETTINGS_KEY],
    activate: options.activate,
  })

  await adapter.writePersonalSettings({
    ...currentSettings,
    ...patch,
    version: 1,
  })

  return {
    themeId: options.importedTheme.id,
    library: patch[THEME_LIBRARY_SETTINGS_KEY] ?? [],
    activated: options.activate === true,
  }
}

/**
 * Full import flow including atomic persistence. The confirmation UI can call
 * the stepwise functions instead; cancellation still changes nothing.
 */
export const importAndPersistTheme = async (options: {
  existingThemeIds: ReadonlySet<string>
  activate?: boolean
  adapter?: ThemePersistenceAdapter
}): Promise<ThemeOperationResult<PersistedThemeImport>> => {
  const imported = await importThemeFromFile({
    existingThemeIds: options.existingThemeIds,
  })

  if (imported.status !== 'ok') {
    return imported
  }

  try {
    const persisted = await persistThemeImport({
      importedTheme: imported.theme,
      activate: options.activate,
      adapter: options.adapter,
    })
    return { status: 'ok', ...persisted }
  } catch (reason) {
    if (reason instanceof ThemeFileError) {
      return { status: 'error', message: reason.message }
    }
    return {
      status: 'error',
      message: reason instanceof Error ? reason.message : String(reason),
    }
  }
}
