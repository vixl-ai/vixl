import { describe, expect, it } from 'vitest'
import {
  THEME_CANVAS_MAX_LAYERS,
  parseThemeDefinition,
  themeDefinitionSchema,
} from '@/schemas/appearance/theme'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import { BUILTIN_VIXL_THEME_ID, type VixlThemeDefinition } from '@/types/appearance/theme'
import { RESERVED_BUILTIN_THEME_IDS } from '@/constants/appearance/built-in-theme-registry'

const validTheme = (): VixlThemeDefinition => ({
  ...structuredClone(builtInVixlTheme),
  id: 'my-theme',
  name: 'My Theme',
})

describe('themeDefinitionSchema', () => {
  it('accepts a complete valid two-variant theme', () => {
    const parsed = parseThemeDefinition(validTheme())
    expect(parsed.success).toBe(true)
  })

  it('accepts short and long hex color forms', () => {
    const theme = validTheme()
    theme.variants.light.colors.background = '#abc'
    theme.variants.light.colors.foreground = '#112233'
    theme.variants.light.colors.border = '#11223344'

    expect(parseThemeDefinition(theme).success).toBe(true)
  })

  it('rejects unknown top-level keys', () => {
    const raw = { ...validTheme(), customCss: 'body { background: red }' }
    expect(themeDefinitionSchema.safeParse(raw).success).toBe(false)
  })

  it('rejects unknown variant keys', () => {
    const theme = validTheme()
    ;(theme.variants.light as Record<string, unknown>).remoteFontUrl = 'https://example.com/f.woff'
    expect(parseThemeDefinition(theme).success).toBe(false)
  })

  it('rejects unsupported versions', () => {
    expect(themeDefinitionSchema.safeParse({ ...validTheme(), version: 1 }).success).toBe(false)
    expect(themeDefinitionSchema.safeParse({ ...validTheme(), version: 3 }).success).toBe(false)
    expect(themeDefinitionSchema.safeParse({ ...validTheme(), version: '2' }).success).toBe(false)
  })

  it('rejects invalid ids', () => {
    const theme = validTheme()
    expect(themeDefinitionSchema.safeParse({ ...theme, id: 'Vixl Default' }).success).toBe(false)
    expect(themeDefinitionSchema.safeParse({ ...theme, id: 'x' }).success).toBe(false)
    expect(themeDefinitionSchema.safeParse({ ...theme, id: '-leading-hyphen' }).success).toBe(false)
  })

  it('rejects every reserved built-in id', () => {
    expect(RESERVED_BUILTIN_THEME_IDS.length).toBeGreaterThanOrEqual(9)
    for (const reservedId of RESERVED_BUILTIN_THEME_IDS) {
      const theme = { ...validTheme(), id: reservedId }
      expect(themeDefinitionSchema.safeParse(theme).success).toBe(false)
    }
    // The original default id stays reserved too.
    expect(
      themeDefinitionSchema.safeParse({ ...validTheme(), id: BUILTIN_VIXL_THEME_ID }).success,
    ).toBe(false)
  })

  it('rejects unsafe colors', () => {
    const theme = validTheme()
    theme.variants.light.colors.background = 'oklch(0.145 0 0)'
    expect(parseThemeDefinition(theme).success).toBe(false)

    const urlTheme = validTheme()
    urlTheme.variants.dark.canvas = {
      fallback: 'url(https://example.com/bg.png)',
      layers: [],
    }
    expect(parseThemeDefinition(urlTheme).success).toBe(false)

    const shortHexTheme = validTheme()
    shortHexTheme.variants.light.colors.border = '#12345'
    expect(parseThemeDefinition(shortHexTheme).success).toBe(false)
  })

  it('rejects unsafe font family values', () => {
    const theme = validTheme()
    theme.variants.light.typography.uiFontFamily = 'Inter; } * { color: red }'
    expect(parseThemeDefinition(theme).success).toBe(false)

    const parenTheme = validTheme()
    parenTheme.variants.dark.typography.monoFontFamily = 'url(evil)'
    expect(parseThemeDefinition(parenTheme).success).toBe(false)
  })

  it('rejects out-of-range font sizes', () => {
    const tooSmall = validTheme()
    tooSmall.variants.light.typography.uiFontSize = 7.5
    expect(parseThemeDefinition(tooSmall).success).toBe(false)

    const tooBig = validTheme()
    tooBig.variants.dark.typography.editorFontSize = 32.5
    expect(parseThemeDefinition(tooBig).success).toBe(false)

    const offStep = validTheme()
    offStep.variants.light.typography.editorFontSize = 13.3
    expect(parseThemeDefinition(offStep).success).toBe(false)
  })
})

describe('v2 canvas schema', () => {
  it('accepts layered linear, radial, and conic canvases', () => {
    const theme = validTheme()
    theme.variants.light.canvas = {
      fallback: '#101018',
      layers: [
        {
          kind: 'linear',
          angle: 135,
          stops: [
            { color: '#ff0000', position: 0 },
            { color: '#00ff00', position: 100 },
          ],
        },
        {
          kind: 'radial',
          x: 25,
          y: 75,
          size: 'farthest-corner',
          stops: [
            { color: '#ffffff00', position: 0 },
            { color: '#ffffff', position: 100 },
          ],
        },
        {
          kind: 'conic',
          angle: 180,
          x: 50,
          y: 50,
          stops: [
            { color: '#0000ff', position: 0 },
            { color: '#ff00ff', position: 100 },
          ],
        },
      ],
    }
    expect(parseThemeDefinition(theme).success).toBe(true)
  })

  it('rejects more than the maximum layer count', () => {
    const theme = validTheme()
    theme.variants.light.canvas = {
      fallback: '#101018',
      layers: Array.from({ length: THEME_CANVAS_MAX_LAYERS + 1 }, () => ({
        kind: 'linear' as const,
        angle: 0,
        stops: [
          { color: '#111111', position: 0 },
          { color: '#222222', position: 100 },
        ],
      })),
    }
    expect(parseThemeDefinition(theme).success).toBe(false)
  })

  it('rejects layer stop counts outside 2-6', () => {
    const tooFew = validTheme()
    tooFew.variants.light.canvas = {
      fallback: '#101018',
      layers: [
        {
          kind: 'linear',
          angle: 0,
          stops: [{ color: '#111111', position: 0 }],
        },
      ],
    }
    expect(parseThemeDefinition(tooFew).success).toBe(false)

    const tooMany = validTheme()
    tooMany.variants.light.canvas = {
      fallback: '#101018',
      layers: [
        {
          kind: 'linear',
          angle: 0,
          stops: Array.from({ length: 7 }, (_, index) => ({
            color: '#111111',
            position: (index * 100) / 6,
          })),
        },
      ],
    }
    expect(parseThemeDefinition(tooMany).success).toBe(false)
  })

  it('rejects unsorted stops and out-of-range geometry', () => {
    const unsorted = validTheme()
    unsorted.variants.light.canvas = {
      fallback: '#101018',
      layers: [
        {
          kind: 'linear',
          angle: 0,
          stops: [
            { color: '#ff0000', position: 60 },
            { color: '#00ff00', position: 20 },
          ],
        },
      ],
    }
    expect(parseThemeDefinition(unsorted).success).toBe(false)

    const badGeometry = validTheme()
    badGeometry.variants.light.canvas = {
      fallback: '#101018',
      layers: [
        {
          kind: 'radial',
          x: 150,
          y: -5,
          size: 'closest-side',
          stops: [
            { color: '#111111', position: 0 },
            { color: '#222222', position: 100 },
          ],
        },
      ],
    }
    expect(parseThemeDefinition(badGeometry).success).toBe(false)

    const badAngle = validTheme()
    badAngle.variants.light.canvas = {
      fallback: '#101018',
      layers: [
        {
          kind: 'conic',
          angle: 400,
          x: 0,
          y: 0,
          stops: [
            { color: '#111111', position: 0 },
            { color: '#222222', position: 100 },
          ],
        },
      ],
    }
    expect(parseThemeDefinition(badAngle).success).toBe(false)
  })

  it('rejects unknown layer kinds and unknown fields', () => {
    const theme = validTheme()
    theme.variants.light.canvas = {
      fallback: '#101018',
      layers: [
        {
          kind: 'mesh',
          stops: [
            { color: '#111111', position: 0 },
            { color: '#222222', position: 100 },
          ],
        },
      ] as unknown as VixlThemeDefinition['variants']['light']['canvas']['layers'],
    }
    expect(parseThemeDefinition(theme).success).toBe(false)
  })
})

describe('v2 glass schema', () => {
  it('accepts bounded glass configurations', () => {
    const theme = validTheme()
    theme.variants.light.glass = {
      enabled: true,
      scopes: ['sidebar', 'panels', 'overlays'],
      surfaceOpacity: 55,
      blur: 24,
      saturation: 180,
      borderOpacity: 40,
      shadow: 'strong',
      radius: 'lg',
    }
    expect(parseThemeDefinition(theme).success).toBe(true)
  })

  it('rejects unknown scopes, presets, and out-of-range glass values', () => {
    const badScope = validTheme()
    badScope.variants.light.glass = {
      ...badScope.variants.light.glass,
      scopes: ['footer' as unknown as 'sidebar'],
    }
    expect(parseThemeDefinition(badScope).success).toBe(false)

    const badBlur = validTheme()
    badBlur.variants.light.glass = {
      ...badBlur.variants.light.glass,
      enabled: true,
      blur: 100,
    }
    expect(parseThemeDefinition(badBlur).success).toBe(false)

    const badSaturation = validTheme()
    badSaturation.variants.light.glass = {
      ...badSaturation.variants.light.glass,
      enabled: true,
      saturation: 250,
    }
    expect(parseThemeDefinition(badSaturation).success).toBe(false)

    const badOpacity = validTheme()
    badOpacity.variants.light.glass = {
      ...badOpacity.variants.light.glass,
      enabled: true,
      surfaceOpacity: 120,
    }
    expect(parseThemeDefinition(badOpacity).success).toBe(false)

    const badShadow = validTheme()
    badShadow.variants.light.glass = {
      ...badShadow.variants.light.glass,
      shadow: 'massive' as unknown as 'subtle',
    }
    expect(parseThemeDefinition(badShadow).success).toBe(false)
  })

  it('rejects unknown glass fields', () => {
    const theme = validTheme()
    ;(theme.variants.light.glass as Record<string, unknown>).css = 'backdrop-filter: url(x)'
    expect(parseThemeDefinition(theme).success).toBe(false)
  })
})

describe('v2 icon appearance schema', () => {
  it('accepts all bundled packs with bounded values', () => {
    for (const pack of ['lucide', 'tabler', 'phosphor'] as const) {
      const theme = validTheme()
      theme.variants.light.icons = { pack, weight: 1.5, sizeScale: 1.2, tint: '#ff8800' }
      expect(parseThemeDefinition(theme).success).toBe(true)
    }
  })

  it('rejects unknown packs and out-of-range values', () => {
    const badPack = validTheme()
    badPack.variants.light.icons = {
      ...badPack.variants.light.icons,
      pack: 'feather' as unknown as 'lucide',
    }
    expect(parseThemeDefinition(badPack).success).toBe(false)

    const badWeight = validTheme()
    badWeight.variants.light.icons = {
      ...badWeight.variants.light.icons,
      weight: 4,
    }
    expect(parseThemeDefinition(badWeight).success).toBe(false)

    const badScale = validTheme()
    badScale.variants.light.icons = {
      ...badScale.variants.light.icons,
      sizeScale: 2,
    }
    expect(parseThemeDefinition(badScale).success).toBe(false)

    const badTint = validTheme()
    badTint.variants.light.icons = {
      ...badTint.variants.light.icons,
      tint: 'rgb(1,2,3)',
    }
    expect(parseThemeDefinition(badTint).success).toBe(false)
  })
})
