import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import { VIXL_APPEARANCE_CHANGE_EVENT } from '@/utils/appearance/resolve-effective-appearance'
import {
  MONACO_EDITOR_FONT_SIZE_DEFAULT,
  MONACO_EDITOR_OPTIONS,
  applyMonacoTheme,
  ensureMonacoBaseThemes,
  markVixlMonacoThemesRegistered,
  resolveMonacoEditorOptions,
  resolveMonacoThemeId,
} from '@/utils/monaco-theme'
import {
  VIXL_CODE_THEME_DARK,
  VIXL_CODE_THEME_LIGHT,
} from '@/components/ai-elements/code-block/vixl-code-theme'

type DefinedTheme = {
  base: string
  inherit: boolean
  rules: unknown[]
  colors: Record<string, string>
}

const makeMonacoApi = () => {
  const definedThemes = new Map<string, DefinedTheme>()
  const setTheme = vi.fn<(themeId: string) => void>()
  return {
    editor: {
      defineTheme: vi.fn<(id: string, theme: DefinedTheme) => void>(
        (id, theme) => void definedThemes.set(id, theme),
      ),
      setTheme: setTheme as unknown as (id: string) => void,
    },
    definedThemes,
    setTheme,
  }
}

const setDarkMode = (dark: boolean): void => {
  document.documentElement.classList.toggle('dark', dark)
}

describe('monaco-theme base registration', () => {
  let monacoApi: ReturnType<typeof makeMonacoApi>

  beforeEach(() => {
    monacoApi = makeMonacoApi()
  })

  it('registers readable light and dark Vixl themes once', () => {
    ensureMonacoBaseThemes(monacoApi as never)

    expect(monacoApi.definedThemes.get(VIXL_CODE_THEME_LIGHT)?.base).toBe('vs')
    expect(monacoApi.definedThemes.get(VIXL_CODE_THEME_DARK)?.base).toBe('vs-dark')
    expect(
      monacoApi.definedThemes.get(VIXL_CODE_THEME_DARK)?.colors['editorSuggestWidget.background'],
    ).toBeTruthy()
    expect(
      monacoApi.definedThemes.get(VIXL_CODE_THEME_LIGHT)?.colors['editorHoverWidget.foreground'],
    ).toBeTruthy()
  })

  it('does not re-register themes after the first call', () => {
    ensureMonacoBaseThemes(monacoApi as never)
    const firstCount = monacoApi.editor.defineTheme.mock.calls.length
    ensureMonacoBaseThemes(monacoApi as never)
    expect(monacoApi.editor.defineTheme.mock.calls.length).toBe(firstCount)
  })
})

describe('monaco-theme resolution', () => {
  beforeEach(() => {
    vi.resetModules()
    markVixlMonacoThemesRegistered()
  })

  afterEach(() => {
    setDarkMode(false)
  })

  it('resolves the dark theme when the root has the dark class', () => {
    setDarkMode(true)
    expect(resolveMonacoThemeId()).toBe(VIXL_CODE_THEME_DARK)
  })

  it('resolves the light theme without the dark class', () => {
    setDarkMode(false)
    expect(resolveMonacoThemeId()).toBe(VIXL_CODE_THEME_LIGHT)
  })

  it('applies the resolved theme to Monaco', () => {
    const monacoApi = makeMonacoApi()
    setDarkMode(true)
    applyMonacoTheme(monacoApi as never)
    expect(monacoApi.setTheme).toHaveBeenCalledWith(VIXL_CODE_THEME_DARK)
  })
})

describe('monaco editor options', () => {
  it('defaults to the 13px editor font size', () => {
    expect(MONACO_EDITOR_FONT_SIZE_DEFAULT).toBe(13)
    expect(MONACO_EDITOR_OPTIONS.fontSize).toBe(MONACO_EDITOR_FONT_SIZE_DEFAULT)
    expect(MONACO_EDITOR_OPTIONS.fontFamily).toContain('JetBrains Mono')
  })

  it('merges an editor font-size override into the base options', () => {
    const options = resolveMonacoEditorOptions(15)
    expect(options.fontSize).toBe(15)
    expect(options.fontFamily).toBe(MONACO_EDITOR_OPTIONS.fontFamily)
    expect(options.fixedOverflowWidgets).toBe(true)
  })

  it('uses the default font size and current theme when no override is given', () => {
    setDarkMode(false)
    const options = resolveMonacoEditorOptions()
    expect(options.fontSize).toBe(MONACO_EDITOR_FONT_SIZE_DEFAULT)
    expect(options.theme).toBe(VIXL_CODE_THEME_LIGHT)
  })
})

describe('observeMonacoTheme', () => {
  beforeEach(() => {
    vi.resetModules()
    markVixlMonacoThemesRegistered()
  })

  afterEach(() => {
    setDarkMode(false)
  })

  it('re-applies the theme when the root class changes and stops on dispose', async () => {
    const { observeMonacoTheme } = await import('@/utils/monaco-theme')
    const monacoApi = makeMonacoApi()
    setDarkMode(false)

    const onApplied = vi.fn<() => void>()
    const dispose = observeMonacoTheme(monacoApi as never, onApplied)

    setDarkMode(true)
    document.documentElement.setAttribute('class', 'dark')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(monacoApi.setTheme).toHaveBeenCalledWith(VIXL_CODE_THEME_DARK)
    expect(onApplied).toHaveBeenCalled()

    dispose()

    monacoApi.setTheme.mockClear()
    setDarkMode(false)
    document.documentElement.removeAttribute('class')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(monacoApi.setTheme).not.toHaveBeenCalled()
  })
})

describe('monaco appearance bridge', () => {
  const customEditorPalette = {
    ...builtInVixlTheme.variants.dark.editor,
    background: '#101018',
    hoverWidgetBackground: '#0c0c14',
  }

  const makeDetail = (overrides: Record<string, unknown> = {}) => ({
    themeId: 'midnight-run',
    themeName: 'Midnight Run',
    builtIn: false,
    colorMode: 'dark',
    variant: 'dark',
    revision: 1,
    previewing: false,
    typography: {
      ...builtInVixlTheme.variants.dark.typography,
      editorFontSize: 15,
    },
    editor: customEditorPalette,
    ...overrides,
  })

  const dispatchAppearanceChange = (detail: Record<string, unknown>): void => {
    window.dispatchEvent(
      new CustomEvent(VIXL_APPEARANCE_CHANGE_EVENT, { detail }),
    )
  }

  beforeEach(() => {
    vi.resetModules()
    markVixlMonacoThemesRegistered()
    window.dispatchEvent(
      new CustomEvent(VIXL_APPEARANCE_CHANGE_EVENT, {
        detail: makeDetail({ themeId: 'vixl-default', builtIn: true, revision: 0 }),
      }),
    )
  })

  afterEach(() => {
    setDarkMode(false)
  })

  it('defines and applies the generated theme on appearance-change', async () => {
    const editorTheme = await import('@/utils/appearance/editor-theme')
    const { applyMonacoTheme, ensureMonacoAppearanceBridge } = await import(
      '@/utils/monaco-theme'
    )
    const monacoApi = makeMonacoApi()

    editorTheme.ensureEditorAppearanceSync()
    ensureMonacoAppearanceBridge(monacoApi as never)
    ensureMonacoAppearanceBridge(monacoApi as never)
    editorTheme.ensureEditorAppearanceSync()

    dispatchAppearanceChange(makeDetail({ revision: 5 }))

    applyMonacoTheme(monacoApi as never)

    const ids = editorTheme.getEditorThemeIds('midnight-run')
    const defined = monacoApi.definedThemes.get(ids.dark)
    expect(defined).toBeTruthy()
    expect(defined?.base).toBe('vs-dark')
    expect(defined?.colors['editor.background']).toBe('#101018')
    expect(defined?.colors['editorHoverWidget.background']).toBe('#0c0c14')
    expect(monacoApi.setTheme).toHaveBeenLastCalledWith(ids.dark)
  })

  it('keeps the built-in theme ids when returning to the built-in theme', async () => {
    const editorTheme = await import('@/utils/appearance/editor-theme')
    const { applyMonacoTheme, ensureMonacoAppearanceBridge } = await import(
      '@/utils/monaco-theme'
    )
    const monacoApi = makeMonacoApi()
    setDarkMode(true)

    editorTheme.ensureEditorAppearanceSync()
    ensureMonacoAppearanceBridge(monacoApi as never)

    dispatchAppearanceChange(
      makeDetail({
        themeId: 'vixl-default',
        builtIn: true,
        revision: 6,
      }),
    )

    applyMonacoTheme(monacoApi as never)

    expect(monacoApi.definedThemes.has(VIXL_CODE_THEME_DARK)).toBe(true)
    expect(monacoApi.setTheme).toHaveBeenLastCalledWith(VIXL_CODE_THEME_DARK)
  })

  it('updates typography on every mounted editor exactly once per event', async () => {
    const editorTheme = await import('@/utils/appearance/editor-theme')
    const { ensureMonacoAppearanceBridge } = await import('@/utils/monaco-theme')
    const monacoApi = makeMonacoApi()

    const editor = { updateOptions: vi.fn<(options: Record<string, unknown>) => void>() }
    const diffEditor = { updateOptions: vi.fn<(options: Record<string, unknown>) => void>() }
    editorTheme.registerMonacoEditorInstance(editor)
    editorTheme.registerMonacoEditorInstance(diffEditor)

    editorTheme.ensureEditorAppearanceSync()
    ensureMonacoAppearanceBridge(monacoApi as never)
    ensureMonacoAppearanceBridge(monacoApi as never)

    dispatchAppearanceChange(makeDetail({ revision: 7 }))

    const call = editor.updateOptions.mock.calls[0]
    expect(call).toBeDefined()
    const options = call?.[0] as {
      fontSize?: number
      fontFamily?: string
      lineHeight?: number
    }
    expect(options.fontSize).toBe(15)
    expect(options.fontFamily).toContain('JetBrains Mono')
    expect(options.lineHeight).toBeCloseTo((15 * 20) / 13, 1)
    expect(diffEditor.updateOptions).toHaveBeenCalledTimes(1)
  })

  it('reflects the custom appearance in newly resolved editor options', async () => {
    const editorTheme = await import('@/utils/appearance/editor-theme')
    const { resolveMonacoEditorOptions } = await import('@/utils/monaco-theme')

    editorTheme.ensureEditorAppearanceSync()
    dispatchAppearanceChange(makeDetail({ revision: 8 }))

    const options = resolveMonacoEditorOptions()
    const ids = editorTheme.getEditorThemeIds('midnight-run')
    expect(options.fontSize).toBe(15)
    expect(options.theme).toBe(ids.dark)
  })
})

