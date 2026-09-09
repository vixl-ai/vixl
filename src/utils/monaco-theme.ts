import type * as monaco from 'monaco-editor'
import {
  VIXL_CODE_THEME_DARK,
  VIXL_CODE_THEME_LIGHT,
} from '@/components/ai-elements/code-block/vixl-code-theme'
import {
  buildEditorMonacoThemeData,
  ensureEditorAppearanceSync,
  getEditorAppearanceState,
  getEditorThemeIds,
  getRegisteredMonacoEditors,
  isEditorThemeBuiltIn,
  onEditorAppearance,
} from '@/utils/appearance/editor-theme'
import { buildFontFamilyCss } from '@/utils/appearance/appearance-css'
import type { VixlThemeTypography } from '@/types/appearance/theme'

export const MONACO_EDITOR_FONT_SIZE_DEFAULT = 13

export const MONACO_EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
  fontSize: MONACO_EDITOR_FONT_SIZE_DEFAULT,
  lineHeight: 20,
  letterSpacing: 0.3,
  fontLigatures: true,
  smoothScrolling: true,
  bracketPairColorization: { enabled: true },
  // Keep LSP hover / suggest / parameter hints above editor text and
  // outside overflow:hidden ancestors (ResizablePanel, tab shells).
  fixedOverflowWidgets: true,
  padding: { top: 8 },
  glyphMargin: false,
  overviewRulerLanes: 0,
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
    useShadows: false,
  },
}

let vixlThemesRegistered = false

const isDarkMode = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

/** Register solid vixl chrome themes before Shiki loads so the first paint matches. */
export const ensureMonacoBaseThemes = (monacoApi: typeof monaco): void => {
  if (vixlThemesRegistered) {
    return
  }

  monacoApi.editor.defineTheme(VIXL_CODE_THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#252525',
      'editor.foreground': '#d4d4d4',
      'editorHoverWidget.background': '#1e1e1e',
      'editorHoverWidget.foreground': '#d4d4d4',
      'editorHoverWidget.border': '#3c3c3c',
      'editorSuggestWidget.background': '#1e1e1e',
      'editorSuggestWidget.foreground': '#d4d4d4',
      'editorSuggestWidget.border': '#3c3c3c',
    },
  })

  monacoApi.editor.defineTheme(VIXL_CODE_THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#252525',
      'editorHoverWidget.background': '#f3f3f3',
      'editorHoverWidget.foreground': '#252525',
      'editorHoverWidget.border': '#c8c8c8',
      'editorSuggestWidget.background': '#f3f3f3',
      'editorSuggestWidget.foreground': '#252525',
      'editorSuggestWidget.border': '#c8c8c8',
    },
  })

  vixlThemesRegistered = true
}

export const markVixlMonacoThemesRegistered = (): void => {
  vixlThemesRegistered = true
}

export const resolveMonacoThemeId = (): string =>
  isDarkMode() ? VIXL_CODE_THEME_DARK : VIXL_CODE_THEME_LIGHT

/**
 * Monaco typography options derived from the effective appearance
 * typography. Line height and letter spacing scale proportionally from the
 * built-in 13px / 20 / 0.3 baseline so the built-in theme stays
 * pixel-identical while custom editor font sizes keep readable metrics.
 */
export const resolveMonacoTypographyOptions = (
  typography: VixlThemeTypography,
): monaco.editor.IEditorOptions => {
  const fontSize = typography.editorFontSize
  return {
    fontFamily: buildFontFamilyCss({
      uiFontFamily: typography.monoFontFamily,
      uiFontFallbacks: typography.monoFontFallbacks,
    }),
    fontSize,
    lineHeight: Math.max(
      1,
      Math.round(
        fontSize *
          ((MONACO_EDITOR_OPTIONS.lineHeight ?? 20) / MONACO_EDITOR_FONT_SIZE_DEFAULT) *
          100,
      ) / 100,
    ),
    letterSpacing: Math.round(fontSize * (0.3 / MONACO_EDITOR_FONT_SIZE_DEFAULT) * 100) / 100,
    fontLigatures: true,
  }
}

/** Built-in default typography options (used when returning to built-in). */
const builtInMonacoTypographyOptions = (): monaco.editor.IEditorOptions => ({
  fontFamily: MONACO_EDITOR_OPTIONS.fontFamily,
  fontSize: MONACO_EDITOR_FONT_SIZE_DEFAULT,
  lineHeight: MONACO_EDITOR_OPTIONS.lineHeight,
  letterSpacing: MONACO_EDITOR_OPTIONS.letterSpacing,
  fontLigatures: true,
})

export const resolveMonacoEditorOptions = (
  fontSize: number = MONACO_EDITOR_FONT_SIZE_DEFAULT,
  typography?: VixlThemeTypography,
): monaco.editor.IStandaloneEditorConstructionOptions => {
  // When no explicit typography is passed, use the effective appearance
  // typography for custom themes so newly mounted editors match the runtime.
  const state = getEditorAppearanceState()
  const effectiveTypography = typography ?? (state.readOnlyBuiltIn ? undefined : state.typography)
  if (!effectiveTypography) {
    return {
      ...MONACO_EDITOR_OPTIONS,
      fontSize,
      theme: resolveMonacoThemeId(),
    }
  }
  return {
    ...MONACO_EDITOR_OPTIONS,
    ...resolveMonacoTypographyOptions(effectiveTypography),
    fontSize: typography ? fontSize : state.typography.editorFontSize,
    // Custom themes follow the resolved adapter variant; the built-in theme
    // keeps the legacy root-class behavior for pixel-identical fallback.
    theme: state.readOnlyBuiltIn
      ? resolveMonacoThemeId()
      : state.variant === 'dark'
        ? getEditorThemeIds(state.themeId).dark
        : getEditorThemeIds(state.themeId).light,
  }
}

/**
 * Define (when custom) and apply the effective editor theme. The built-in
 * theme keeps its stable ids; custom themes get collision-safe generated ids
 * derived from the theme id and current variant.
 */
const applyEffectiveMonacoTheme = (monacoApi: typeof monaco): void => {
  if (isEditorThemeBuiltIn()) {
    monacoApi.editor.setTheme(resolveMonacoThemeId())
    return
  }
  const state = getEditorAppearanceState()
  const ids = getEditorThemeIds(state.themeId)
  const themeId = state.variant === 'dark' ? ids.dark : ids.light
  monacoApi.editor.defineTheme(
    themeId,
    buildEditorMonacoThemeData(state.variant, state.editor) as monaco.editor.IStandaloneThemeData,
  )
  monacoApi.editor.setTheme(themeId)
}

export const applyMonacoTheme = (monacoApi: typeof monaco): void => {
  ensureMonacoBaseThemes(monacoApi)
  applyEffectiveMonacoTheme(monacoApi)
}

export const observeMonacoTheme = (
  monacoApi: typeof monaco,
  onApplied?: () => void,
): (() => void) => {
  if (typeof document === 'undefined') {
    return () => {}
  }

  const observer = new MutationObserver(() => {
    applyMonacoTheme(monacoApi)
    onApplied?.()
  })

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })

  return () => {
    observer.disconnect()
  }
}

let appearanceBridgeAttached = false

/**
 * Attach the shared appearance-change bridge exactly once: on every
 * `vixl:appearance-change`, define/update the generated editor theme, call
 * Monaco's global `setTheme`, and refresh typography on every mounted editor.
 * Repeated calls (per editor mount) never add duplicate listeners.
 */
export const ensureMonacoAppearanceBridge = (monacoApi: typeof monaco): void => {
  if (appearanceBridgeAttached) {
    return
  }
  ensureEditorAppearanceSync()
  onEditorAppearance(() => {
    applyEffectiveMonacoTheme(monacoApi)
    const options = isEditorThemeBuiltIn()
      ? builtInMonacoTypographyOptions()
      : resolveMonacoTypographyOptions(getEditorAppearanceState().typography)
    for (const editor of getRegisteredMonacoEditors()) {
      editor.updateOptions(options as Record<string, unknown>)
    }
  })
  appearanceBridgeAttached = true
}
