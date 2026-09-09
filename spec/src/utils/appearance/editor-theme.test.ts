import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import { BUILTIN_VIXL_THEME_ID } from '@/types/appearance/theme'
import {
  VIXL_CODE_THEME_DARK,
  VIXL_CODE_THEME_LIGHT,
} from '@/components/ai-elements/code-block/vixl-code-theme'
import { VIXL_APPEARANCE_CHANGE_EVENT } from '@/utils/appearance/resolve-effective-appearance'
import {
  buildEditorMonacoThemeData,
  buildEditorShikiTheme,
  editorAppearanceRevision,
  ensureEditorAppearanceSync,
  getActiveCodeThemeIds,
  getActiveEditorTypography,
  getEditorAppearanceState,
  getEditorPaletteSignature,
  getEditorThemeIds,
  getRegisteredMonacoEditors,
  onEditorAppearance,
  registerMonacoEditorInstance,
  resetEditorAppearanceForTests,
  unregisterMonacoEditorInstance,
} from '@/utils/appearance/editor-theme'
import type { AppearanceChangeEventDetail } from '@/utils/appearance/resolve-effective-appearance'

const makeDetail = (
  overrides: Partial<AppearanceChangeEventDetail> = {},
): AppearanceChangeEventDetail => ({
  themeId: 'midnight-run',
  themeName: 'Midnight Run',
  readOnlyBuiltIn: false,
  usesCssDefaults: false,
  colorMode: 'dark',
  variant: 'dark',
  revision: 1,
  previewing: false,
  typography: {
    ...builtInVixlTheme.variants.dark.typography,
    editorFontSize: 15,
  },
  editor: {
    ...builtInVixlTheme.variants.dark.editor,
    background: '#101018',
    hoverWidgetBackground: '#0c0c14',
  },
  ...overrides,
})

const dispatchAppearanceChange = (detail: AppearanceChangeEventDetail): void => {
  window.dispatchEvent(
    new CustomEvent<AppearanceChangeEventDetail>(VIXL_APPEARANCE_CHANGE_EVENT, { detail }),
  )
}

beforeEach(() => {
  resetEditorAppearanceForTests()
})

afterEach(() => {
  resetEditorAppearanceForTests()
  document.documentElement.classList.remove('dark')
})

describe('editor theme ids', () => {
  it('keeps the built-in theme ids for the built-in theme', () => {
    expect(getEditorThemeIds(BUILTIN_VIXL_THEME_ID)).toEqual({
      light: VIXL_CODE_THEME_LIGHT,
      dark: VIXL_CODE_THEME_DARK,
    })
    expect(getActiveCodeThemeIds()).toEqual({
      light: VIXL_CODE_THEME_LIGHT,
      dark: VIXL_CODE_THEME_DARK,
    })
  })

  it('generates deterministic, collision-safe ids for custom themes', () => {
    const first = getEditorThemeIds('my theme')
    expect(first.light).not.toBe(first.dark)
    expect(first.light).toContain('my-theme')
    expect(getEditorThemeIds('my theme')).toEqual(first)

    // Distinct ids that slug to the same value must never share theme ids.
    const second = getEditorThemeIds('my.theme')
    expect(second).not.toEqual(first)
    expect(getEditorThemeIds('my_theme')).not.toEqual(first)
    expect(getEditorThemeIds('my_theme')).not.toEqual(second)
  })

  it('never produces ids that collide with the built-in ids', () => {
    for (const themeId of [VIXL_CODE_THEME_LIGHT, VIXL_CODE_THEME_DARK, 'vixl-light', '']) {
      const ids = getEditorThemeIds(themeId)
      expect(ids.light).not.toBe(VIXL_CODE_THEME_LIGHT)
      expect(ids.light).not.toBe(VIXL_CODE_THEME_DARK)
      expect(ids.dark).not.toBe(VIXL_CODE_THEME_LIGHT)
      expect(ids.dark).not.toBe(VIXL_CODE_THEME_DARK)
    }
  })
})

describe('editor theme data', () => {
  it('builds Monaco theme data from the effective palette', () => {
    const data = buildEditorMonacoThemeData('dark', makeDetail().editor)

    expect(data.base).toBe('vs-dark')
    expect(data.inherit).toBe(true)
    expect(data.colors['editor.background']).toBe('#101018')
    expect(data.colors['editorHoverWidget.background']).toBe('#0c0c14')
    expect(data.colors['editorSuggestWidget.foreground']).toBeTruthy()
    // Token rules keep the palette syntax colors (leading # stripped).
    const commentRule = data.rules.find((rule) => rule.token === 'comment')
    expect(commentRule?.foreground).toBe(builtInVixlTheme.variants.dark.editor.comment.slice(1))
  })

  it('builds a light Monaco theme with readable widget colors', () => {
    const data = buildEditorMonacoThemeData('light', builtInVixlTheme.variants.light.editor)
    expect(data.base).toBe('vs')
    expect(data.colors['editor.background']).toBe(builtInVixlTheme.variants.light.editor.background)
    expect(data.colors['editorSuggestWidget.background']).toBe(
      builtInVixlTheme.variants.light.editor.suggestWidgetBackground,
    )
  })

  it('builds a Shiki registration from the effective palette', () => {
    const ids = getEditorThemeIds('midnight-run')
    const registration = buildEditorShikiTheme('midnight-run', 'dark', makeDetail().editor)
    expect(registration.name).toBe(ids.dark)
    expect(registration.type).toBe('dark')
    expect(registration.fg).toBe(makeDetail().editor.foreground)
    expect(registration.bg).toBe('#101018')
    expect((registration.settings ?? []).length).toBeGreaterThan(0)
  })
})

describe('appearance-change synchronization', () => {
  it('defaults to the built-in appearance', () => {
    expect(getEditorAppearanceState().readOnlyBuiltIn).toBe(true)
    expect(getEditorAppearanceState().themeId).toBe(BUILTIN_VIXL_THEME_ID)
    expect(getActiveEditorTypography()).toEqual(builtInVixlTheme.variants.light.typography)
  })

  it('updates state and listeners from one normalized event', () => {
    ensureEditorAppearanceSync()
    const listener = vi.fn<(state: unknown) => void>()
    const unsubscribe = onEditorAppearance(listener)

    dispatchAppearanceChange(makeDetail({ revision: 7 }))

    const state = getEditorAppearanceState()
    expect(state.themeId).toBe('midnight-run')
    expect(state.readOnlyBuiltIn).toBe(false)
    expect(state.variant).toBe('dark')
    expect(state.revision).toBe(7)
    expect(state.editor.background).toBe('#101018')
    expect(getActiveEditorTypography().editorFontSize).toBe(15)
    expect(editorAppearanceRevision.value).toBe(7)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('attaches exactly one window listener across repeated sync calls', () => {
    ensureEditorAppearanceSync()
    ensureEditorAppearanceSync()
    ensureEditorAppearanceSync()

    const listener = vi.fn<(state: unknown) => void>()
    onEditorAppearance(listener)

    dispatchAppearanceChange(makeDetail({ revision: 2 }))

    // One event fans out to each logical subscriber exactly once.
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getEditorAppearanceState().revision).toBe(2)
  })

  it('tracks mounted editors without applying options itself', () => {
    ensureEditorAppearanceSync()
    const editor = { updateOptions: vi.fn<(options: Record<string, unknown>) => void>() }
    const otherEditor = { updateOptions: vi.fn<(options: Record<string, unknown>) => void>() }
    registerMonacoEditorInstance(editor)
    registerMonacoEditorInstance(otherEditor)
    expect(getRegisteredMonacoEditors()).toHaveLength(2)

    dispatchAppearanceChange(makeDetail({ revision: 3 }))

    // The adapter layer only stores state and fans out listeners; the Monaco
    // bridge (monaco-theme) is responsible for calling updateOptions.
    expect(editor.updateOptions).not.toHaveBeenCalled()
    expect(otherEditor.updateOptions).not.toHaveBeenCalled()
  })

  it('stops updating unregistered editors', () => {
    ensureEditorAppearanceSync()
    const editor = { updateOptions: vi.fn<(options: Record<string, unknown>) => void>() }
    registerMonacoEditorInstance(editor)
    unregisterMonacoEditorInstance(editor)
    expect(getRegisteredMonacoEditors()).toHaveLength(0)
  })

  it('derives a stable palette signature', () => {
    ensureEditorAppearanceSync()
    dispatchAppearanceChange(makeDetail({ revision: 4 }))
    const signature = getEditorPaletteSignature(getEditorAppearanceState())
    expect(signature).toContain('midnight-run')
    expect(getEditorPaletteSignature(getEditorAppearanceState())).toBe(signature)
  })
})
