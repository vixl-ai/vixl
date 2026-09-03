import type { BundledLanguage } from 'shiki'
import { createHighlighter } from 'shiki'
import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco'
import type * as monaco from 'monaco-editor'
import {
  VIXL_CODE_THEME_DARK,
  VIXL_CODE_THEME_LIGHT,
  vixlCodeThemeDark,
  vixlCodeThemeLight,
} from '@/components/ai-elements/code-block/vixl-code-theme'
import {
  markVixlMonacoThemesRegistered,
  resolveMonacoThemeId,
} from '@/utils/monaco-theme'

type MonacoApi = typeof monaco
type VixlHighlighter = Awaited<ReturnType<typeof createHighlighter>>

const PRELOAD_LANGS = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'vue',
  'vue-html',
  'html',
  'css',
  'scss',
  'less',
  'json',
  'jsonc',
  'yaml',
  'markdown',
  'astro',
  'svelte',
  'graphql',
  'prisma',
  'sql',
  'dockerfile',
  'toml',
  'xml',
  'rust',
  'zig',
  'c',
  'cpp',
  'java',
  'go',
  'python',
  'shellscript',
  'cmake',
  'ini',
  'diff',
  'make',
  'bash',
  'kotlin',
  'php',
  'lua',
  'ruby',
  'csharp',
  'swift',
  'objective-c',
] as const satisfies readonly BundledLanguage[]

const CUSTOM_LANGUAGE_IDS = [
  'vue',
  'astro',
  'svelte',
  'zig',
  'prisma',
  'graphql',
  'terraform',
  'dockerfile',
  'kotlin',
  'elixir',
  'gleam',
  'nix',
] as const

let highlighterPromise: Promise<VixlHighlighter> | null = null
let highlighterInstance: VixlHighlighter | null = null
let shikiWired = false
const registeredLanguages = new Set<string>()
const loadedLanguages = new Set<string>()

const registerLanguageId = (monacoApi: MonacoApi, languageId: string): void => {
  if (registeredLanguages.has(languageId)) {
    return
  }
  if (!monacoApi.languages.getLanguages().some((language) => language.id === languageId)) {
    monacoApi.languages.register({ id: languageId })
  }
  registeredLanguages.add(languageId)
}

const isDarkMode = (): boolean =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')

/** Prefer the active mode as themeIds[0] so shikiToMonaco's initial setTheme matches. */
const orderedVixlThemes = () =>
  isDarkMode()
    ? [vixlCodeThemeDark, vixlCodeThemeLight]
    : [vixlCodeThemeLight, vixlCodeThemeDark]

const ensureHighlighter = async (): Promise<VixlHighlighter> => {
  if (highlighterInstance) {
    return highlighterInstance
  }
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: orderedVixlThemes(),
      langs: [...PRELOAD_LANGS],
    })
      .then((highlighter) => {
        highlighterInstance = highlighter
        for (const lang of PRELOAD_LANGS) {
          loadedLanguages.add(lang)
        }
        return highlighter
      })
      .catch((error: unknown) => {
        highlighterPromise = null
        throw error
      })
  }
  return highlighterPromise
}

/**
 * shikiToMonaco defines themes with inherit:false and only a couple of editor.*
 * colors, which can leave default text unreadable. Redefine with inherit:true
 * and explicit foreground / background.
 */
const hardenVixlMonacoThemes = (monacoApi: MonacoApi, highlighter: VixlHighlighter): void => {
  for (const themeId of highlighter.getLoadedThemes()) {
    if (themeId !== VIXL_CODE_THEME_LIGHT && themeId !== VIXL_CODE_THEME_DARK) {
      continue
    }
    const converted = textmateThemeToMonacoTheme(
      highlighter.getTheme(themeId),
    ) as monaco.editor.IStandaloneThemeData
    const isDark = themeId === VIXL_CODE_THEME_DARK
    const themeData: monaco.editor.IStandaloneThemeData = {
      base: converted.base,
      inherit: true,
      rules: converted.rules,
      colors: {
        ...converted.colors,
        'editor.background': isDark ? '#252525' : '#ffffff',
        'editor.foreground': isDark ? '#d4d4d4' : '#252525',
        'editorHoverWidget.background': isDark ? '#1e1e1e' : '#f3f3f3',
        'editorHoverWidget.foreground': isDark ? '#d4d4d4' : '#252525',
        'editorHoverWidget.border': isDark ? '#3c3c3c' : '#c8c8c8',
        'editorSuggestWidget.background': isDark ? '#1e1e1e' : '#f3f3f3',
        'editorSuggestWidget.foreground': isDark ? '#d4d4d4' : '#252525',
        'editorSuggestWidget.border': isDark ? '#3c3c3c' : '#c8c8c8',
      },
    }
    monacoApi.editor.defineTheme(themeId, themeData)
  }
  markVixlMonacoThemesRegistered()
}

const wireShikiToMonaco = (monacoApi: MonacoApi, highlighter: VixlHighlighter): void => {
  if (shikiWired) {
    return
  }
  shikiToMonaco(highlighter, monacoApi)
  hardenVixlMonacoThemes(monacoApi, highlighter)
  // shikiToMonaco sets themeIds[0]; force the active mode so we never flash light/dark.
  monacoApi.editor.setTheme(resolveMonacoThemeId())
  shikiWired = true
}

export const ensureMonacoShiki = async (monacoApi: MonacoApi): Promise<void> => {
  const highlighter = await ensureHighlighter()

  for (const languageId of CUSTOM_LANGUAGE_IDS) {
    registerLanguageId(monacoApi, languageId)
  }
  for (const languageId of PRELOAD_LANGS) {
    registerLanguageId(monacoApi, languageId)
  }

  wireShikiToMonaco(monacoApi, highlighter)
}

export const ensureMonacoLanguage = async (
  monacoApi: MonacoApi,
  languageId: string,
): Promise<void> => {
  if (languageId === 'plaintext' || languageId === 'text') {
    return
  }

  await ensureMonacoShiki(monacoApi)
  registerLanguageId(monacoApi, languageId)

  if (loadedLanguages.has(languageId)) {
    return
  }

  const highlighter = await ensureHighlighter()
  try {
    await highlighter.loadLanguage(languageId as BundledLanguage)
    loadedLanguages.add(languageId)
    // Do not call shikiToMonaco again: it re-patches setTheme/create and breaks
    // subsequent editor mounts. Preloaded langs cover the common set; rare langs
    // keep Monaco's default tokenization until a full remount path is added.
  } catch {
    return
  }
}
