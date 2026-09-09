import { describe, expect, it } from 'vitest'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import {
  getEffectiveAppearanceSignature,
  resolveEffectiveAppearance,
  resolveAppearanceVariant,
  type AppearancePreviewDraft,
} from '@/utils/appearance/resolve-effective-appearance'
import { BUILTIN_VIXL_THEME_ID } from '@/types/appearance/theme'
import type { VixlThemeDefinition } from '@/types/appearance/theme'

const customTheme: VixlThemeDefinition = {
  id: 'midnight-run',
  name: 'Midnight Run',
  version: 2,
  variants: {
    light: {
      colors: {
        ...builtInVixlTheme.variants.light.colors,
        background: '#f7f7f2',
        primary: '#2244aa',
      },
      canvas: {
        fallback: '#101018',
        layers: [
          {
            kind: 'linear',
            angle: 135,
            stops: [
              { color: '#101018', position: 0 },
              { color: '#1c1c2a', position: 100 },
            ],
          },
        ],
      },
      glass: { ...builtInVixlTheme.variants.light.glass },
      icons: { ...builtInVixlTheme.variants.light.icons },
      typography: {
        ...builtInVixlTheme.variants.light.typography,
        uiFontSize: 14,
      },
      editor: { ...builtInVixlTheme.variants.light.editor, background: '#f0f0ea' },
    },
    dark: {
      colors: {
        ...builtInVixlTheme.variants.dark.colors,
        background: '#050508',
        primary: '#88aaff',
      },
      canvas: { fallback: '#050508', layers: [] },
      glass: { ...builtInVixlTheme.variants.dark.glass },
      icons: { ...builtInVixlTheme.variants.dark.icons },
      typography: builtInVixlTheme.variants.dark.typography,
      editor: builtInVixlTheme.variants.dark.editor,
    },
  },
}

describe('resolveAppearanceVariant', () => {
  it('resolves system mode from the OS preference', () => {
    expect(resolveAppearanceVariant('system', true)).toBe('dark')
    expect(resolveAppearanceVariant('system', false)).toBe('light')
  })

  it('respects forced light/dark color modes', () => {
    expect(resolveAppearanceVariant('dark', false)).toBe('dark')
    expect(resolveAppearanceVariant('light', true)).toBe('light')
  })

  it('lets a preview variant override the resolved mode', () => {
    expect(resolveAppearanceVariant('light', false, 'dark')).toBe('dark')
  })
})

describe('resolveEffectiveAppearance', () => {
  it('resolves the built-in theme for light and dark modes', () => {
    const light = resolveEffectiveAppearance({ colorMode: 'light' })
    expect(light.themeId).toBe(BUILTIN_VIXL_THEME_ID)
    expect(light.readOnlyBuiltIn).toBe(true)
    // Only the Vixl Default theme uses the CSS cascade defaults.
    expect(light.usesCssDefaults).toBe(true)
    expect(light.variant).toBe('light')
    expect(light.colors).toEqual(builtInVixlTheme.variants.light.colors)
    expect(light.glass).toEqual(builtInVixlTheme.variants.light.glass)
    expect(light.icons).toEqual(builtInVixlTheme.variants.light.icons)
    expect(light.editor).toEqual(builtInVixlTheme.variants.light.editor)

    const dark = resolveEffectiveAppearance({ colorMode: 'dark' })
    expect(dark.variant).toBe('dark')
    expect(dark.colors).toEqual(builtInVixlTheme.variants.dark.colors)
  })

  it('resolves system mode via systemDark', () => {
    expect(resolveEffectiveAppearance({ colorMode: 'system', systemDark: true }).variant).toBe(
      'dark',
    )
    expect(resolveEffectiveAppearance({ colorMode: 'system', systemDark: false }).variant).toBe(
      'light',
    )
  })

  it('applies the active saved theme for the resolved variant', () => {
    const dark = resolveEffectiveAppearance({
      colorMode: 'dark',
      theme: customTheme,
    })
    expect(dark.readOnlyBuiltIn).toBe(false)
    expect(dark.usesCssDefaults).toBe(false)
    expect(dark.themeId).toBe('midnight-run')
    expect(dark.themeName).toBe('Midnight Run')
    expect(dark.colors.background).toBe('#050508')
    expect(dark.canvas).toEqual({ fallback: '#050508', layers: [] })

    const light = resolveEffectiveAppearance({ colorMode: 'light', theme: customTheme })
    expect(light.colors.background).toBe('#f7f7f2')
    expect(light.typography.uiFontSize).toBe(14)
  })

  it('falls back to the built-in theme when the selection is missing or malformed', () => {
    const fallback = resolveEffectiveAppearance({ colorMode: 'dark', theme: null })
    expect(fallback.readOnlyBuiltIn).toBe(true)
    expect(fallback.usesCssDefaults).toBe(true)
    expect(fallback.themeId).toBe(BUILTIN_VIXL_THEME_ID)

    const malformed = { id: 'broken' } as unknown as VixlThemeDefinition
    expect(resolveEffectiveAppearance({ colorMode: 'dark', theme: malformed }).themeId).toBe(
      BUILTIN_VIXL_THEME_ID,
    )
  })

  it('classifies reserved built-in ids as read-only but not CSS-default', () => {
    // A curated built-in id (definition ships with the bundled-theme registry
    // work) is read-only but must still receive runtime variables.
    const curated = {
      ...structuredClone(builtInVixlTheme),
      id: 'midnight-aurora',
      name: 'Midnight Aurora',
    } as VixlThemeDefinition
    const effective = resolveEffectiveAppearance({ colorMode: 'light', theme: curated })
    expect(effective.readOnlyBuiltIn).toBe(true)
    expect(effective.usesCssDefaults).toBe(false)
  })

  it('preview drafts win over the selection and the resolved mode', () => {
    const preview: AppearancePreviewDraft = {
      theme: customTheme,
      variant: 'light',
    }
    const effective = resolveEffectiveAppearance({
      colorMode: 'dark',
      theme: null,
      preview,
    })
    expect(effective.themeId).toBe('midnight-run')
    expect(effective.readOnlyBuiltIn).toBe(false)
    expect(effective.usesCssDefaults).toBe(false)
    expect(effective.variant).toBe('light')
    expect(effective.colors.background).toBe('#f7f7f2')
  })

  it('previewing only a variant keeps the selected theme', () => {
    const effective = resolveEffectiveAppearance({
      colorMode: 'light',
      theme: customTheme,
      preview: { variant: 'dark' },
    })
    expect(effective.variant).toBe('dark')
    expect(effective.themeId).toBe('midnight-run')
    expect(effective.colors.background).toBe('#050508')
  })

  it('produces stable signatures for identical appearances', () => {
    const appearance = resolveEffectiveAppearance({ colorMode: 'dark' })
    const a = getEffectiveAppearanceSignature(appearance, { previewing: false })
    const b = getEffectiveAppearanceSignature(appearance, { previewing: false })
    expect(a).toBe(b)
    expect(getEffectiveAppearanceSignature(appearance, { previewing: true })).not.toBe(a)
  })

  it('changes the signature when glass or icons change', () => {
    const base = resolveEffectiveAppearance({ colorMode: 'dark', theme: customTheme })
    const glassEdit = structuredClone(customTheme)
    glassEdit.variants.dark.glass = {
      ...glassEdit.variants.dark.glass,
      enabled: true,
      blur: 8,
    }
    const withGlass = resolveEffectiveAppearance({ colorMode: 'dark', theme: glassEdit })
    expect(getEffectiveAppearanceSignature(withGlass, { previewing: false })).not.toBe(
      getEffectiveAppearanceSignature(base, { previewing: false }),
    )

    const iconEdit = structuredClone(customTheme)
    iconEdit.variants.dark.icons = { ...iconEdit.variants.dark.icons, pack: 'tabler' }
    const withIcons = resolveEffectiveAppearance({ colorMode: 'dark', theme: iconEdit })
    expect(getEffectiveAppearanceSignature(withIcons, { previewing: false })).not.toBe(
      getEffectiveAppearanceSignature(base, { previewing: false }),
    )
  })
})
