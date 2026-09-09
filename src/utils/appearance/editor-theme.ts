import { ref } from 'vue'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import {
  VIXL_CODE_THEME_DARK,
  VIXL_CODE_THEME_LIGHT,
  createVixlCodeTheme,
} from '@/components/ai-elements/code-block/vixl-code-theme'
import type { RawThemeSetting, ThemeRegistration } from 'shiki'
import {
  BUILTIN_VIXL_THEME_ID,
  type VixlThemeEditorPalette,
  type VixlThemeTypography,
  type VixlThemeVariantKind,
} from '@/types/appearance/theme'
import type { AppearanceChangeEventDetail } from '@/utils/appearance/resolve-effective-appearance'
import { VIXL_APPEARANCE_CHANGE_EVENT } from '@/utils/appearance/resolve-effective-appearance'

/**
 * Monaco/Shiki editor-theme adapter.
 *
 * Keeps the resolved editor palette, typography, and theme ids from the
 * appearance runtime in one place so Monaco and the code-block highlighter
 * consume the exact same effective palette (no theme drift).
 *
 * This module is deliberately Monaco-free: it stores state, builds theme
 * data, tracks mounted editors, and fans out the normalized
 * `vixl:appearance-change` signal. The Monaco application layer lives in
 * `@/utils/monaco-theme`.
 */

/** Minimal shape of a mounted Monaco (or diff) editor instance. */
export type MonacoEditorLike = {
  updateOptions: (options: Record<string, unknown>) => void
}

/** Effective editor state derived from the appearance-change event. */
export type EditorAppearanceState = {
  themeId: string
  themeName: string
  /** True when the theme is a bundled built-in (immutable). */
  readOnlyBuiltIn: boolean
  variant: VixlThemeVariantKind
  typography: VixlThemeTypography
  editor: VixlThemeEditorPalette
  revision: number
}

/** Theme ids for one theme (light + dark variants). */
export type EditorThemeIds = { light: string; dark: string }

/** Reactive revision counter for Vue consumers (code blocks). */
export const editorAppearanceRevision = ref(0)

const defaultState = (): EditorAppearanceState => {
  const dark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const variant: VixlThemeVariantKind = dark ? 'dark' : 'light'
  const variantTheme = builtInVixlTheme.variants[variant]
  return {
    themeId: BUILTIN_VIXL_THEME_ID,
    themeName: builtInVixlTheme.name,
    readOnlyBuiltIn: true,
    variant,
    typography: variantTheme.typography,
    editor: variantTheme.editor,
    revision: 0,
  }
}

let currentState: EditorAppearanceState = defaultState()
let windowListenerAttached = false
let windowListener: ((event: Event) => void) | null = null

const appearanceListeners = new Set<(state: EditorAppearanceState) => void>()
const trackedEditors = new Set<MonacoEditorLike>()

/**
 * Collision-safe generated theme ids for a theme id: a sanitized slug plus a
 * hash of the raw id, so distinct theme ids that slug to the same value
 * (e.g. "My Theme" and "My.Theme") never share generated theme ids. The
 * built-in theme keeps the existing stable `vixl-light` / `vixl-dark` ids.
 */
export const getEditorThemeIds = (themeId: string): EditorThemeIds => {
  if (themeId === BUILTIN_VIXL_THEME_ID) {
    return { light: VIXL_CODE_THEME_LIGHT, dark: VIXL_CODE_THEME_DARK }
  }
  const slug = themeId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  let hash = 0x811c9dc5
  for (let index = 0; index < themeId.length; index += 1) {
    hash ^= themeId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const suffix = hash.toString(36).padStart(6, '0')
  const base = `vixl-gen-${slug || 'theme'}-${suffix}`
  return { light: `${base}-light`, dark: `${base}-dark` }
}

/** Shiki registration for a theme variant built from the editor palette. */
export const buildEditorShikiTheme = (
  themeId: string,
  variant: VixlThemeVariantKind,
  palette: VixlThemeEditorPalette,
): ThemeRegistration => {
  const ids = getEditorThemeIds(themeId)
  return createVixlCodeTheme(ids[variant], variant, palette)
}

/** Monaco rule for one shiki token-color setting scope. */
const shikiSettingToMonacoRule = (
  scope: string,
  settings: RawThemeSetting['settings'],
): { token: string; foreground?: string; fontStyle?: string } | null => {
  if (!scope) {
    return null
  }
  const foreground =
    typeof settings.foreground === 'string' ? settings.foreground.replace(/^#/, '') : undefined
  const fontStyle = typeof settings.fontStyle === 'string' ? settings.fontStyle : undefined
  if (!foreground && !fontStyle) {
    return null
  }
  return {
    token: scope,
    ...(foreground ? { foreground } : {}),
    ...(fontStyle ? { fontStyle } : {}),
  }
}

/**
 * Monaco theme data for a theme variant built from the editor palette,
 * including readable hover/suggest widget colors.
 */
export const buildEditorMonacoThemeData = (
  variant: VixlThemeVariantKind,
  palette: VixlThemeEditorPalette,
): {
  base: 'vs' | 'vs-dark'
  inherit: boolean
  rules: Array<{ token: string; foreground?: string; fontStyle?: string }>
  colors: Record<string, string>
} => {
  const registration = buildEditorShikiTheme(BUILTIN_VIXL_THEME_ID, variant, palette)
  const rules: Array<{ token: string; foreground?: string; fontStyle?: string }> = []
  for (const setting of registration.settings as RawThemeSetting[]) {
    const scopeValue = setting.scope ?? []
    const scopes = Array.isArray(scopeValue) ? scopeValue : [scopeValue]
    for (const scope of scopes) {
      const rule = shikiSettingToMonacoRule(scope, setting.settings)
      if (rule) {
        rules.push(rule)
      }
    }
  }
  return {
    base: variant === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules,
    colors: {
      'editor.background': palette.background,
      'editor.foreground': palette.foreground,
      'editorHoverWidget.background': palette.hoverWidgetBackground,
      'editorHoverWidget.foreground': palette.hoverWidgetForeground,
      'editorHoverWidget.border': palette.hoverWidgetBorder,
      'editorSuggestWidget.background': palette.suggestWidgetBackground,
      'editorSuggestWidget.foreground': palette.suggestWidgetForeground,
      'editorSuggestWidget.border': palette.suggestWidgetBorder,
    },
  }
}

const applyAppearanceDetail = (detail: AppearanceChangeEventDetail): void => {
  currentState = {
    themeId: detail.themeId,
    themeName: detail.themeName,
    readOnlyBuiltIn: detail.readOnlyBuiltIn,
    variant: detail.variant,
    typography: detail.typography,
    editor: detail.editor,
    revision: detail.revision,
  }
  editorAppearanceRevision.value = detail.revision
  for (const listener of appearanceListeners) {
    listener(currentState)
  }
}

/**
 * Attach the single shared `vixl:appearance-change` window listener. Safe to
 * call repeatedly: exactly one listener is ever registered and repeated calls
 * are no-ops.
 */
export const ensureEditorAppearanceSync = (): void => {
  if (windowListenerAttached || typeof window === 'undefined') {
    return
  }
  windowListener = (event: Event): void => {
    const detail = (event as CustomEvent<AppearanceChangeEventDetail>).detail
    if (!detail || typeof detail !== 'object') {
      return
    }
    applyAppearanceDetail(detail)
  }
  window.addEventListener(VIXL_APPEARANCE_CHANGE_EVENT, windowListener)
  windowListenerAttached = true
}

/** Subscribe to effective editor-appearance changes. Returns an unsubscribe. */
export const onEditorAppearance = (
  listener: (state: EditorAppearanceState) => void,
): (() => void) => {
  ensureEditorAppearanceSync()
  appearanceListeners.add(listener)
  return () => {
    appearanceListeners.delete(listener)
  }
}

/** Track a mounted Monaco editor so appearance updates reach it. */
export const registerMonacoEditorInstance = (editor: MonacoEditorLike): void => {
  trackedEditors.add(editor)
}

/** Stop tracking a disposed Monaco editor instance. */
export const unregisterMonacoEditorInstance = (editor: MonacoEditorLike): void => {
  trackedEditors.delete(editor)
}

export const getRegisteredMonacoEditors = (): MonacoEditorLike[] => [...trackedEditors]

export const getEditorAppearanceState = (): EditorAppearanceState => currentState

export const getActiveEditorPalette = (): VixlThemeEditorPalette => currentState.editor

export const getActiveEditorTypography = (): VixlThemeTypography => currentState.typography

export const getActiveEditorVariant = (): VixlThemeVariantKind => currentState.variant

export const isEditorThemeBuiltIn = (): boolean => currentState.readOnlyBuiltIn

/** Theme id Monaco should currently display for the active variant. */
export const getActiveMonacoThemeId = (): string => {
  const ids = getEditorThemeIds(currentState.themeId)
  return currentState.variant === 'dark' ? ids.dark : ids.light
}

/** Active light/dark code-block theme ids (built-in or generated). */
export const getActiveCodeThemeIds = (): EditorThemeIds => getEditorThemeIds(currentState.themeId)

/** Stable signature of the effective editor palette (cache keys). */
export const getEditorPaletteSignature = (state: EditorAppearanceState): string =>
  [
    state.themeId,
    state.variant,
    state.readOnlyBuiltIn ? 'builtin' : 'custom',
    state.revision,
    JSON.stringify(state.editor),
  ].join('|')

/** Reset the runtime state (test teardown only). */
export const resetEditorAppearanceForTests = (): void => {
  if (windowListenerAttached && windowListener && typeof window !== 'undefined') {
    window.removeEventListener(VIXL_APPEARANCE_CHANGE_EVENT, windowListener)
  }
  windowListener = null
  windowListenerAttached = false
  appearanceListeners.clear()
  trackedEditors.clear()
  currentState = defaultState()
  editorAppearanceRevision.value = 0
}
