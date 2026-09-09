import { open, save } from '@tauri-apps/plugin-dialog'
import { call, isTauri } from './helpers'

const THEME_DIALOG_FILTERS = [{ name: 'Vixl Theme (JSON)', extensions: ['json'] }]

const requireTauri = (): void => {
  if (!isTauri()) {
    throw new Error('Vixl desktop APIs are only available in the Tauri app')
  }
}

/**
 * Open a single-file picker for shareable `.vixl-theme.json` files.
 * Returns `null` when the user cancels the dialog (a no-op, not an error).
 */
export const pickThemeFile = async (): Promise<string | null> => {
  requireTauri()

  const selected = await open({
    directory: false,
    multiple: false,
    filters: THEME_DIALOG_FILTERS,
  })

  if (selected === null) {
    return null
  }

  return Array.isArray(selected) ? (selected[0] ?? null) : selected
}

/**
 * Open a save picker for a theme file with a sanitized default filename
 * (including the `.vixl-theme.json` extension). Returns `null` on cancel.
 */
export const pickThemeSavePath = async (defaultName: string): Promise<string | null> => {
  requireTauri()

  return save({
    defaultPath: defaultName,
    filters: THEME_DIALOG_FILTERS,
  })
}

export type ThemeFileContent = {
  content: string
  sizeBytes: number
}

/**
 * Read the raw text of a user-selected theme file. The Rust command enforces
 * a pre-parse size cap before any content reaches the webview; JSON parsing
 * and strict schema validation stay in the import service.
 */
export const readThemeFile = (path: string): Promise<ThemeFileContent> =>
  call('read_theme_file', { path })

/**
 * Write canonical theme JSON to a user-selected path atomically
 * (temp file + rename) so interrupted saves never leave truncated files.
 */
export const writeThemeFile = (path: string, content: string): Promise<void> =>
  call('write_theme_file', { path, content })
