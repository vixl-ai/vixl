import type * as monaco from 'monaco-editor'
import {
  VIXL_CODE_THEME_DARK,
  VIXL_CODE_THEME_LIGHT,
} from '@/components/ai-elements/code-block/vixl-code-theme'

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
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')

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

export const resolveMonacoEditorOptions = (
  fontSize: number = MONACO_EDITOR_FONT_SIZE_DEFAULT,
): monaco.editor.IStandaloneEditorConstructionOptions => ({
  ...MONACO_EDITOR_OPTIONS,
  fontSize,
  theme: resolveMonacoThemeId(),
})

export const applyMonacoTheme = (monacoApi: typeof monaco): void => {
  ensureMonacoBaseThemes(monacoApi)
  monacoApi.editor.setTheme(resolveMonacoThemeId())
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
