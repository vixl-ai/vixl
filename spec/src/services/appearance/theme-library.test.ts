import { describe, expect, it } from 'vitest'
import { THEME_LIBRARY_MAX_SIZE } from '@/schemas/appearance/theme'
import { BUILTIN_VIXL_THEME_ID } from '@/types/appearance/theme'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import {
  cleanAppearanceThemeState,
  resolveActiveCustomTheme,
  resolveCollisionSafeThemeId,
  resolveThemeById,
  sanitizeThemeLibrary,
  slugifyThemeName,
} from '@/services/appearance/theme-library'
import type { VixlThemeDefinition } from '@/types/appearance/theme'

const makeTheme = (id: string, name = 'My Theme'): VixlThemeDefinition => ({
  ...structuredClone(builtInVixlTheme),
  id,
  name,
})

describe('sanitizeThemeLibrary', () => {
  it('keeps valid entries in order', () => {
    const library = sanitizeThemeLibrary([makeTheme('alpha'), makeTheme('beta')])
    expect(library.map((theme) => theme.id)).toEqual(['alpha', 'beta'])
  })

  it('returns an empty array for non-array input', () => {
    expect(sanitizeThemeLibrary(undefined)).toEqual([])
    expect(sanitizeThemeLibrary('nope')).toEqual([])
  })

  it('drops invalid entries without failing', () => {
    const library = sanitizeThemeLibrary([
      makeTheme('alpha'),
      { id: 'broken' },
      makeTheme('Vixl Default'.toLowerCase()),
      makeTheme('beta'),
    ])
    expect(library.map((theme) => theme.id)).toEqual(['alpha', 'beta'])
  })

  it('deduplicates ids keeping the first occurrence', () => {
    const first = makeTheme('dup', 'First')
    const second = makeTheme('dup', 'Second')
    const library = sanitizeThemeLibrary([first, second])
    expect(library).toHaveLength(1)
    expect(library[0]?.name).toBe('First')
  })

  it('caps the library at the maximum size', () => {
    const raw = Array.from({ length: THEME_LIBRARY_MAX_SIZE + 10 }, (_, index) =>
      makeTheme(`theme-${index}`),
    )
    const library = sanitizeThemeLibrary(raw)
    expect(library).toHaveLength(THEME_LIBRARY_MAX_SIZE)
  })
})

describe('resolveThemeById', () => {
  const library = [makeTheme('alpha')]

  it('finds a stored theme', () => {
    expect(resolveThemeById(library, 'alpha')?.id).toBe('alpha')
  })

  it('falls back to null for missing, built-in, or empty ids', () => {
    expect(resolveThemeById(library, 'missing')).toBeNull()
    expect(resolveThemeById(library, BUILTIN_VIXL_THEME_ID)).toBeNull()
    expect(resolveThemeById(library, undefined)).toBeNull()
  })
})

describe('resolveActiveCustomTheme', () => {
  it('resolves the active stored theme', () => {
    const library = [makeTheme('alpha')]
    expect(resolveActiveCustomTheme(library, 'alpha')?.id).toBe('alpha')
  })

  it('falls back to null for malformed or dangling active ids', () => {
    const library = [makeTheme('alpha')]
    expect(resolveActiveCustomTheme(library, 42)).toBeNull()
    expect(resolveActiveCustomTheme(library, '')).toBeNull()
    expect(resolveActiveCustomTheme(library, 'dangling')).toBeNull()
  })
})

describe('resolveCollisionSafeThemeId', () => {
  it('keeps unused ids untouched', () => {
    expect(resolveCollisionSafeThemeId('nightfall', ['solar'])).toBe('nightfall')
  })

  it('never returns the reserved built-in id', () => {
    expect(resolveCollisionSafeThemeId(BUILTIN_VIXL_THEME_ID, [])).toBe('vixl-default-2')
  })

  it('suffixes colliding ids while preserving the display name', () => {
    const existing = ['nightfall', 'nightfall-2', 'nightfall-3']
    expect(resolveCollisionSafeThemeId('nightfall', existing)).toBe('nightfall-4')
  })

  it('shortens overlong ids before suffixing', () => {
    const longId = 'a'.repeat(64)
    const result = resolveCollisionSafeThemeId(longId, [])
    expect(result).toBe(longId)

    const taken = resolveCollisionSafeThemeId(longId, [longId])
    expect(taken.length).toBeLessThanOrEqual(64)
    expect(taken.startsWith('a'.repeat(56))).toBe(true)
  })
})

describe('slugifyThemeName', () => {
  it('slugifies names into valid theme ids', () => {
    expect(slugifyThemeName('Night Fall 2026!')).toBe('night-fall-2026')
    expect(slugifyThemeName('  --Weird__name--  ')).toBe('weird-name')
    expect(slugifyThemeName('!!!')).toBe('custom-theme')
  })

  it('caps slug length so id + suffix fits the id pattern', () => {
    const slug = slugifyThemeName('a'.repeat(200))
    expect(slug.length).toBeLessThanOrEqual(48)
  })
})

describe('cleanAppearanceThemeState', () => {
  it('returns cleaned library and active id', () => {
    const cleaned = cleanAppearanceThemeState([makeTheme('alpha')], 'alpha')
    expect(cleaned.themeLibrary.map((theme) => theme.id)).toEqual(['alpha'])
    expect(cleaned.activeThemeId).toBe('alpha')
  })

  it('drops a dangling active id so the built-in theme resolves', () => {
    const cleaned = cleanAppearanceThemeState([makeTheme('alpha')], 'deleted-id')
    expect(cleaned.activeThemeId).toBeUndefined()
  })

  it('keeps the built-in id from activating a custom theme', () => {
    const cleaned = cleanAppearanceThemeState([makeTheme('alpha')], BUILTIN_VIXL_THEME_ID)
    expect(cleaned.activeThemeId).toBeUndefined()
  })

  it('sanitizes malformed libraries', () => {
    const cleaned = cleanAppearanceThemeState([{ broken: true }, makeTheme('ok')], 'ok')
    expect(cleaned.themeLibrary.map((theme) => theme.id)).toEqual(['ok'])
    expect(cleaned.activeThemeId).toBe('ok')
  })
})

describe('theme file payload interop', () => {
  // Shareable-file shape produced by @/schemas/appearance/theme-file.
  const filePayloadTheme = (id: string): Record<string, unknown> => {
    const color = (index: number): string =>
      `#${(0x100000 + index).toString(16).slice(-6).padStart(6, '0')}`

    const tokens: Record<string, string> = {
      background: color(1),
      foreground: color(2),
      card: color(3),
      cardForeground: color(4),
      popover: color(5),
      popoverForeground: color(6),
      primary: color(7),
      primaryForeground: color(8),
      secondary: color(9),
      secondaryForeground: color(10),
      muted: color(11),
      mutedForeground: color(12),
      accent: color(13),
      accentForeground: color(14),
      destructive: color(15),
      border: color(17),
      input: color(18),
      ring: color(19),
      sidebar: color(20),
      sidebarForeground: color(21),
      sidebarPrimary: color(22),
      sidebarPrimaryForeground: color(23),
      sidebarAccent: color(24),
      sidebarAccentForeground: color(25),
      sidebarBorder: color(26),
      sidebarRing: color(27),
      chart1: color(28),
      chart2: color(29),
      chart3: color(30),
      chart4: color(31),
      chart5: color(32),
    }

    const editor: Record<string, string> = {
      background: color(33),
      foreground: color(34),
      comment: color(35),
      keyword: color(36),
      keywordAccent: color(37),
      string: color(38),
      number: color(39),
      function: color(40),
      type: color(41),
      variable: color(42),
      constant: color(43),
      operator: color(44),
      invalid: color(45),
      regexp: color(46),
      attribute: color(47),
      tag: color(48),
      escape: color(49),
    }

    const variant = {
      tokens,
      background: {
        kind: 'gradient',
        fallback: color(50),
        angle: 90,
        stops: [
          { color: color(51), position: 0 },
          { color: color(52), position: 100 },
        ],
      },
      editor,
    }

    return {
      format: 'vixl-theme',
      version: 1,
      id,
      name: 'Imported Theme',
      typography: {
        uiFontFamily: 'Inter Variable',
        monoFontFamily: 'JetBrains Mono',
        uiFontSize: 13,
        editorFontSize: 13,
      },
      variants: { light: variant, dark: variant },
    }
  }

  it('converts file-format entries into runtime definitions instead of dropping them', () => {
    const library = sanitizeThemeLibrary([filePayloadTheme('imported')])
    expect(library).toHaveLength(1)
    const theme = library[0]
    if (!theme) {
      throw new Error('expected a converted theme')
    }
    expect(theme.id).toBe('imported')
    expect(theme.name).toBe('Imported Theme')
    expect(theme.variants.light.colors.background).toBe(theme.variants.dark.colors.background)
    const canvas = theme.variants.light.canvas
    // v1 single gradients migrate into exactly one v2 linear layer.
    const layer = canvas.layers[0]
    if (layer?.kind !== 'linear') {
      throw new Error('expected a migrated linear layer')
    }
    expect(canvas.fallback).toBe('#100032')
    expect(layer.angle).toBe(90)
    expect(layer.stops).toHaveLength(2)
    // Glass defaults to disabled; icons default to the Lucide compatibility
    // settings.
    expect(theme.variants.light.glass).toEqual({
      enabled: false,
      scopes: [],
      surfaceOpacity: 100,
      blur: 0,
      saturation: 100,
      borderOpacity: 0,
      shadow: 'none',
      radius: 'none',
    })
    expect(theme.variants.light.icons).toEqual({
      pack: 'lucide',
      weight: 2,
      sizeScale: 1,
      tint: 'inherit',
    })
    // Widget colors and font fallbacks are filled from the built-in theme.
    expect(theme.variants.light.editor.hoverWidgetBackground).toBe(
      builtInVixlTheme.variants.light.editor.hoverWidgetBackground,
    )
    expect(theme.variants.light.typography.uiFontFallbacks).toEqual(
      builtInVixlTheme.variants.light.typography.uiFontFallbacks,
    )
  })

  it('migrates persisted v1 domain entries into the v2 shape', () => {
    // A v1 entry never carried glass/icons; drop the v2-only fields the way a
    // real persisted v1 value would look.
    const light = structuredClone(builtInVixlTheme.variants.light) as Record<string, unknown>
    const dark = structuredClone(builtInVixlTheme.variants.dark) as Record<string, unknown>
    for (const variant of [light, dark]) {
      delete variant.glass
      delete variant.icons
    }
    light.canvas = {
      type: 'gradient',
      angle: 135,
      stops: [
        { color: '#101018', position: 0 },
        { color: '#1c1c2a', position: 100 },
      ],
    }
    dark.canvas = { type: 'solid', color: '#050508' }

    const v1Entry = {
      ...structuredClone(builtInVixlTheme),
      id: 'legacy-theme',
      name: 'Legacy Theme',
      version: 1,
      variants: { light, dark },
    } as Record<string, unknown>

    const library = sanitizeThemeLibrary([v1Entry])
    expect(library).toHaveLength(1)
    const theme = library[0]
    if (!theme) {
      throw new Error('expected a migrated theme')
    }
    expect(theme.version).toBe(2)
    expect(theme.variants.light.canvas).toEqual({
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
    })
    // Solid v1 canvases keep their color as the v2 fallback with no layers.
    expect(theme.variants.dark.canvas).toEqual({ fallback: '#050508', layers: [] })
    expect(theme.variants.light.glass.enabled).toBe(false)
    expect(theme.variants.light.icons.pack).toBe('lucide')
    // Colors and editor palettes are copied unchanged.
    expect(theme.variants.light.colors.background).toBe(
      builtInVixlTheme.variants.light.colors.background,
    )
    expect(theme.variants.light.editor).toEqual(builtInVixlTheme.variants.light.editor)
  })

  it('never lets a file-format entry store the reserved built-in id', () => {
    const library = sanitizeThemeLibrary([filePayloadTheme(BUILTIN_VIXL_THEME_ID)])
    expect(library).toHaveLength(0)
  })
})
