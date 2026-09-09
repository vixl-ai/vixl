import type { BundledLanguage, HighlighterGeneric, ThemedToken, ThemeRegistration } from 'shiki'
import { createHighlighter } from 'shiki'
import { vixlCodeThemes } from './vixl-code-theme'
import {
  buildEditorShikiTheme,
  ensureEditorAppearanceSync,
  getActiveCodeThemeIds,
  getEditorAppearanceState,
  getEditorPaletteSignature,
  isEditorThemeBuiltIn,
  onEditorAppearance,
} from '@/utils/appearance/editor-theme'

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
export const isItalic = (fontStyle: number | undefined) => fontStyle && fontStyle & 1
export const isBold = (fontStyle: number | undefined) => fontStyle && fontStyle & 2
export const isUnderline = (fontStyle: number | undefined) => fontStyle && fontStyle & 4

export interface TokenizedCode {
  tokens: ThemedToken[][]
  fg: string
  bg: string
}

// Highlighter cache (singleton per language + palette signature)
const highlighterCache = new Map<
  string,
  Promise<HighlighterGeneric<BundledLanguage, string>>
>()

// Token cache
const tokensCache = new Map<string, TokenizedCode>()

// Subscribers for async token updates
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>()

const getTokensCacheKey = (code: string, language: BundledLanguage) => {
  const start = code.slice(0, 100)
  const end = code.length > 100 ? code.slice(-100) : ''
  return `${language}:${code.length}:${start}:${end}`
}

// Palette signature so highlighters and tokens rebuild when the effective
// editor palette changes (custom theme activation, live preview edits).
let appearanceSyncAttached = false

const getPaletteSignature = (): string => {
  if (!appearanceSyncAttached) {
    attachAppearanceSync()
    appearanceSyncAttached = true
  }
  return getEditorPaletteSignature(getEditorAppearanceState())
}

const attachAppearanceSync = (): void => {
  ensureEditorAppearanceSync()
  onEditorAppearance(() => {
    // The effective palette changed: drop cached highlighters and tokens so
    // the next render rebuilds them from the resolved palette.
    highlighterCache.clear()
    tokensCache.clear()
    subscribers.clear()
  })
}

/**
 * Active code-block theme registrations: the built-in Vixl pair for the
 * built-in theme, or generated registrations built from the effective editor
 * palette so code blocks and Monaco share one palette.
 */
const getActiveThemeRegistrations = (): ThemeRegistration[] => {
  if (isEditorThemeBuiltIn()) {
    return [...vixlCodeThemes]
  }
  const state = getEditorAppearanceState()
  return [
    ...vixlCodeThemes,
    buildEditorShikiTheme(state.themeId, 'light', state.editor),
    buildEditorShikiTheme(state.themeId, 'dark', state.editor),
  ]
}

const getHighlighter = (
  language: BundledLanguage,
  signature: string,
): Promise<HighlighterGeneric<BundledLanguage, string>> => {
  const cached = highlighterCache.get(signature)
  if (cached) {
    return cached
  }

  const highlighterPromise = createHighlighter({
    themes: getActiveThemeRegistrations(),
    langs: [language],
  }) as unknown as Promise<HighlighterGeneric<BundledLanguage, string>>

  highlighterCache.set(signature, highlighterPromise)
  return highlighterPromise
}

// Create raw tokens for immediate display while highlighting loads
export const createRawTokens = (code: string): TokenizedCode => {
  return {
    tokens: code.split('\n').map(line =>
      line === ''
        ? []
        : [
            {
              content: line,
              color: 'inherit',
            } as ThemedToken,
          ],
    ),
    fg: 'inherit',
    bg: 'transparent',
  }
}

// Synchronous highlight with callback for async results
export const highlightCode = (
  code: string,
  language: BundledLanguage,
  callback?: (result: TokenizedCode) => void,
): TokenizedCode | null => {
  const signature = getPaletteSignature()
  const themeIds = getActiveCodeThemeIds()
  const tokensCacheKey = `${signature}:${getTokensCacheKey(code, language)}`

  // Return cached result if available
  const cached = tokensCache.get(tokensCacheKey)
  if (cached) {
    return cached
  }

  // Subscribe callback if provided
  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, new Set())
    }
    subscribers.get(tokensCacheKey)?.add(callback)
  }

  // Start highlighting in background
  getHighlighter(language, signature)
    .then((highlighter) => {
      const availableLangs = highlighter.getLoadedLanguages()
      const langToUse = availableLangs.includes(language) ? language : 'text'

      const result = highlighter.codeToTokens(code, {
        lang: langToUse,
        themes: {
          light: themeIds.light,
          dark: themeIds.dark,
        },
      })

      const tokenized: TokenizedCode = {
        tokens: result.tokens,
        fg: result.fg ?? 'inherit',
        bg: result.bg ?? 'transparent',
      }

      // Cache the result
      tokensCache.set(tokensCacheKey, tokenized)

      // Notify all subscribers
      const subs = subscribers.get(tokensCacheKey)
      if (subs) {
        for (const sub of subs) {
          sub(tokenized)
        }
        subscribers.delete(tokensCacheKey)
      }
    })
    .catch(() => {
      subscribers.delete(tokensCacheKey)
    })

  return null
}
