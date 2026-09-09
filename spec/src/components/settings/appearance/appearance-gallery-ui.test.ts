import { describe, expect, it } from 'vitest'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import { BUNDLED_THEMES } from '@/constants/appearance/built-in-theme-registry'
import type { VixlThemeDefinition, VixlThemeVariant } from '@/types/appearance/theme'
import {
  canvasSummaryLabel,
  glassBadgeLabel,
  groupGalleryThemes,
  iconPackLabel,
  themeCardAriaLabel,
  variantSwatchStyles,
} from '@/components/settings/appearance/appearance-gallery-ui'

const makeTheme = (overrides: Partial<VixlThemeDefinition> = {}): VixlThemeDefinition => ({
  ...structuredClone(builtInVixlTheme),
  id: 'my-theme',
  name: 'My Theme',
  ...overrides,
})

describe('groupGalleryThemes', () => {
  it('groups bundled themes as built-in, preserving registry order', () => {
    const groups = groupGalleryThemes(BUNDLED_THEMES, [])
    expect(groups.builtIn).toHaveLength(BUNDLED_THEMES.length)
    expect(groups.builtIn.every((entry) => entry.builtIn && entry.group === 'built-in')).toBe(true)
    // Vixl Default stays first.
    expect(groups.builtIn[0]?.theme.id).toBe(builtInVixlTheme.id)
  })

  it('groups personal themes as custom (editable, not built-in)', () => {
    const custom = makeTheme()
    const groups = groupGalleryThemes(BUNDLED_THEMES, [custom])
    expect(groups.custom).toEqual([
      { theme: custom, group: 'custom', builtIn: false },
    ])
  })
})

describe('glassBadgeLabel', () => {
  it('reports off when glass is disabled or has no scopes', () => {
    const off = builtInVixlTheme.variants.light.glass
    expect(glassBadgeLabel(off)).toBe('Glass off')
    expect(
      glassBadgeLabel({ ...off, enabled: true, scopes: [] }),
    ).toBe('Glass off')
  })

  it('lists enabled scopes and collapses the full set to "on"', () => {
    const base = builtInVixlTheme.variants.light.glass
    expect(
      glassBadgeLabel({ ...base, enabled: true, scopes: ['sidebar', 'panels'] }),
    ).toBe('Glass: sidebar, panels')
    expect(
      glassBadgeLabel({
        ...base,
        enabled: true,
        scopes: ['sidebar', 'panels', 'overlays'],
      }),
    ).toBe('Glass on')
  })
})

describe('canvasSummaryLabel', () => {
  it('describes solid canvases', () => {
    expect(canvasSummaryLabel(builtInVixlTheme.variants.light.canvas)).toBe('Solid canvas')
  })

  it('counts layers and deduplicates kind names', () => {
    const canvas: VixlThemeVariant['canvas'] = {
      fallback: '#101018',
      layers: [
        {
          kind: 'radial',
          x: 20,
          y: 20,
          size: 'closest-side',
          stops: [
            { color: '#6366f166', position: 0 },
            { color: '#6366f100', position: 100 },
          ],
        },
        {
          kind: 'radial',
          x: 80,
          y: 40,
          size: 'farthest-side',
          stops: [
            { color: '#22d3ee55', position: 0 },
            { color: '#22d3ee00', position: 100 },
          ],
        },
        {
          kind: 'linear',
          angle: 180,
          stops: [
            { color: '#ffffff', position: 0 },
            { color: '#000000', position: 100 },
          ],
        },
      ],
    }
    expect(canvasSummaryLabel(canvas)).toBe('3 gradient layers (radial, linear)')
    expect(
      canvasSummaryLabel({
        fallback: '#101018',
        layers: [canvas.layers[0] as VixlThemeVariant['canvas']['layers'][number]],
      }),
    ).toBe('1 gradient layer (radial)')
  })
})

describe('variantSwatchStyles', () => {
  it('builds thumbnail styles from the variant tokens', () => {
    const variant = builtInVixlTheme.variants.light
    const styles = variantSwatchStyles(variant)
    // Canvas uses the same runtime serializer as the app background.
    expect(styles.canvas.background).toContain(variant.canvas.fallback)
    expect(styles.sidebar).toEqual({ backgroundColor: variant.colors.sidebar })
    expect(styles.accent).toEqual({ backgroundColor: variant.colors.primary })
    expect(styles.text).toEqual({ backgroundColor: variant.colors.foreground })
    // Glass is off for the built-in default: panels stay the opaque card color.
    expect(styles.panel).toEqual({
      backgroundColor: variant.colors.card,
      borderColor: variant.colors.border,
    })
  })

  it('hints glass on panels via color-mix when the panels scope is enabled', () => {
    const variant: VixlThemeVariant = {
      ...structuredClone(builtInVixlTheme.variants.light),
      glass: {
        ...builtInVixlTheme.variants.light.glass,
        enabled: true,
        scopes: ['sidebar', 'panels', 'overlays'],
        surfaceOpacity: 60,
      },
    }
    const styles = variantSwatchStyles(variant)
    expect(styles.panel.backgroundColor).toBe(
      'color-mix(in srgb, #ffffff 60%, transparent)',
    )
  })

  it('keeps panels opaque when glass is enabled but panels are not scoped', () => {
    const variant: VixlThemeVariant = {
      ...structuredClone(builtInVixlTheme.variants.light),
      glass: {
        ...builtInVixlTheme.variants.light.glass,
        enabled: true,
        scopes: ['overlays'],
      },
    }
    expect(variantSwatchStyles(variant).panel.backgroundColor).toBe(
      builtInVixlTheme.variants.light.colors.card,
    )
  })
})

describe('labels', () => {
  it('labels icon packs', () => {
    expect(iconPackLabel('lucide')).toBe('Lucide')
    expect(iconPackLabel('tabler')).toBe('Tabler')
    expect(iconPackLabel('phosphor')).toBe('Phosphor')
  })

  it('builds a full accessible card name including group and active state', () => {
    const theme = makeTheme()
    expect(themeCardAriaLabel(theme, 'custom', false)).toBe('My Theme (custom theme)')
    expect(themeCardAriaLabel(theme, 'custom', true)).toBe(
      'My Theme (custom theme, active)',
    )
    expect(themeCardAriaLabel(builtInVixlTheme, 'built-in', true)).toBe(
      'Vixl Default (built-in theme, active)',
    )
  })
})
