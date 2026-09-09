import { beforeEach, describe, expect, it } from 'vitest'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import {
  APPEARANCE_GLASS_ATTRIBUTE,
  APPEARANCE_MODE_ATTRIBUTE,
  APPEARANCE_PREVIEW_ATTRIBUTE,
  APPEARANCE_REVISION_ATTRIBUTE,
  APPEARANCE_THEME_ATTRIBUTE,
  CANVAS_BACKGROUND_VARIABLE,
  CANVAS_IMAGE_VARIABLE,
  FONT_SIZE_UI_VARIABLE,
  FONT_UI_VARIABLE,
  GLASS_BLUR_VARIABLE,
  GLASS_SURFACE_OPACITY_VARIABLE,
  applyEffectiveAppearance,
  buildCanvasCss,
  buildCanvasLayerCss,
  buildGlassVariables,
  buildFontFamilyCss,
  clearAppearanceAttributes,
  clearAppearanceVariables,
  semanticTokenVariableName,
} from '@/utils/appearance/appearance-css'
import { resolveEffectiveAppearance } from '@/utils/appearance/resolve-effective-appearance'
import type { VixlThemeCanvas, VixlThemeDefinition, VixlThemeGlass } from '@/types/appearance/theme'
import { BUILTIN_VIXL_THEME_ID } from '@/types/appearance/theme'

const customTheme: VixlThemeDefinition = {
  id: 'mint-panel',
  name: 'Mint Panel',
  version: 2,
  variants: {
    light: {
      colors: {
        ...builtInVixlTheme.variants.light.colors,
        background: '#f0fff8',
        cardForeground: '#123322',
      },
      canvas: {
        fallback: '#ffffff',
        layers: [
          {
            kind: 'linear',
            angle: 45,
            stops: [
              { color: '#e2ffe0', position: 100 },
              { color: '#ffffff', position: 0 },
            ],
          },
        ],
      },
      glass: { ...builtInVixlTheme.variants.light.glass },
      icons: { ...builtInVixlTheme.variants.light.icons },
      typography: {
        ...builtInVixlTheme.variants.light.typography,
        uiFontFamily: 'Atkinson Hyperlegible',
        uiFontSize: 14.5,
      },
      editor: builtInVixlTheme.variants.light.editor,
    },
    dark: builtInVixlTheme.variants.dark,
  },
}

const enabledGlass = (): VixlThemeGlass => ({
  enabled: true,
  scopes: ['sidebar', 'panels', 'overlays'],
  surfaceOpacity: 60,
  blur: 16,
  saturation: 120,
  borderOpacity: 30,
  shadow: 'medium',
  radius: 'md',
})

describe('semanticTokenVariableName', () => {
  it('maps camelCase tokens to kebab-case CSS variables', () => {
    expect(semanticTokenVariableName('background')).toBe('--background')
    expect(semanticTokenVariableName('cardForeground')).toBe('--card-foreground')
    expect(semanticTokenVariableName('sidebarPrimaryForeground')).toBe(
      '--sidebar-primary-foreground',
    )
    expect(semanticTokenVariableName('chart1')).toBe('--chart-1')
    expect(semanticTokenVariableName('chart5')).toBe('--chart-5')
  })
})

describe('buildCanvasLayerCss', () => {
  it('renders linear layers with stops sorted by position', () => {
    const gradient = buildCanvasLayerCss({
      kind: 'linear',
      angle: 45,
      stops: [
        { color: '#e2ffe0', position: 100 },
        { color: '#ffffff', position: 0 },
      ],
    })
    expect(gradient).toBe('linear-gradient(45deg, #ffffff 0%, #e2ffe0 100%)')
  })

  it('clamps angles and stop positions into the allowed range', () => {
    const gradient = buildCanvasLayerCss({
      kind: 'linear',
      angle: 420,
      stops: [
        { color: '#000000', position: -10 },
        { color: '#ffffff', position: 140 },
      ],
    })
    expect(gradient).toBe('linear-gradient(360deg, #000000 0%, #ffffff 100%)')
  })

  it('renders radial layers with size and clamped center', () => {
    expect(
      buildCanvasLayerCss({
        kind: 'radial',
        x: 20,
        y: 80,
        size: 'farthest-corner',
        stops: [
          { color: '#111111', position: 0 },
          { color: '#222222', position: 100 },
        ],
      }),
    ).toBe('radial-gradient(farthest-corner at 20% 80%, #111111 0%, #222222 100%)')
  })

  it('renders conic layers with a clamped start angle and origin', () => {
    expect(
      buildCanvasLayerCss({
        kind: 'conic',
        angle: 420,
        x: 150,
        y: 0,
        stops: [
          { color: '#111111', position: 0 },
          { color: '#222222', position: 100 },
        ],
      }),
    ).toBe('conic-gradient(from 360deg at 100% 0%, #111111 0%, #222222 100%)')
  })

  it('returns null for degenerate layers with fewer than two stops', () => {
    expect(
      buildCanvasLayerCss({
        kind: 'linear',
        angle: 0,
        stops: [{ color: '#333333', position: 50 }],
      }),
    ).toBeNull()
  })
})

describe('buildCanvasCss', () => {
  it('uses the explicit fallback for solid canvases', () => {
    expect(buildCanvasCss({ fallback: '#101010', layers: [] })).toEqual({
      color: '#101010',
      image: 'none',
    })
  })

  it('renders a single linear layer over the fallback', () => {
    const canvas: VixlThemeCanvas = {
      fallback: '#111111',
      layers: [
        {
          kind: 'linear',
          angle: 90,
          stops: [
            { color: '#111111', position: 0 },
            { color: '#222222', position: 100 },
          ],
        },
      ],
    }
    expect(buildCanvasCss(canvas)).toEqual({
      color: '#111111',
      image: 'linear-gradient(90deg, #111111 0%, #222222 100%)',
    })
  })

  it('composes multiple layers in paint order (first layer on top)', () => {
    const canvas: VixlThemeCanvas = {
      fallback: '#000000',
      layers: [
        {
          kind: 'radial',
          x: 10,
          y: 20,
          size: 'closest-side',
          stops: [
            { color: '#ffffff', position: 0 },
            { color: '#111111', position: 100 },
          ],
        },
        {
          kind: 'conic',
          angle: 0,
          x: 50,
          y: 50,
          stops: [
            { color: '#ff0000', position: 0 },
            { color: '#0000ff', position: 100 },
          ],
        },
      ],
    }
    const { image } = buildCanvasCss(canvas)
    expect(image).toBe(
      'radial-gradient(closest-side at 10% 20%, #ffffff 0%, #111111 100%), ' +
        'conic-gradient(from 0deg at 50% 50%, #ff0000 0%, #0000ff 100%)',
    )
  })
})

describe('buildGlassVariables', () => {
  it('returns null when glass is disabled', () => {
    expect(buildGlassVariables({ ...enabledGlass(), enabled: false })).toBeNull()
  })

  it('maps bounded glass values into allowlisted CSS variables', () => {
    const variables = buildGlassVariables(enabledGlass())
    expect(variables).toEqual({
      '--vixl-glass-surface-opacity': '60%',
      '--vixl-glass-blur': '16px',
      '--vixl-glass-saturation': '120%',
      '--vixl-glass-border-opacity': '30%',
      '--vixl-glass-shadow': '0 4px 16px rgb(0 0 0 / 0.14)',
      '--vixl-glass-radius': '0.75rem',
    })
  })
})

describe('buildFontFamilyCss', () => {
  it('quotes families with spaces and appends fallbacks', () => {
    expect(
      buildFontFamilyCss({
        uiFontFamily: 'Atkinson Hyperlegible',
        uiFontFallbacks: ['Inter', 'system-ui'],
      }),
    ).toBe('"Atkinson Hyperlegible", Inter, system-ui')
  })

  it('keeps bare identifiers unquoted and skips empty families', () => {
    expect(buildFontFamilyCss({ uiFontFamily: 'Inter', uiFontFallbacks: ['', 'monospace'] })).toBe(
      'Inter, monospace',
    )
  })
})

describe('applyEffectiveAppearance / clearAppearanceVariables', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    clearAppearanceAttributes(document.documentElement)
  })

  it('applies tokens, canvas, glass, typography, and data attributes', () => {
    const theme = structuredClone(customTheme)
    theme.variants.light.glass = enabledGlass()
    const appearance = resolveEffectiveAppearance({
      colorMode: 'light',
      theme,
    })
    applyEffectiveAppearance(document.documentElement, appearance, {
      revision: 3,
      previewing: false,
    })

    const style = document.documentElement.style
    expect(style.getPropertyValue('--background')).toBe('#f0fff8')
    expect(style.getPropertyValue('--card-foreground')).toBe('#123322')
    expect(style.getPropertyValue('--chart-1')).toBe(builtInVixlTheme.variants.light.colors.chart1)
    expect(style.getPropertyValue(CANVAS_BACKGROUND_VARIABLE)).toBe('#ffffff')
    expect(style.getPropertyValue(CANVAS_IMAGE_VARIABLE)).toBe(
      'linear-gradient(45deg, #ffffff 0%, #e2ffe0 100%)',
    )
    expect(style.getPropertyValue(GLASS_SURFACE_OPACITY_VARIABLE)).toBe('60%')
    expect(style.getPropertyValue(GLASS_BLUR_VARIABLE)).toBe('16px')
    expect(document.documentElement.getAttribute(APPEARANCE_GLASS_ATTRIBUTE)).toBe(
      'sidebar panels overlays',
    )
    expect(style.getPropertyValue(FONT_UI_VARIABLE)).toBe(
      '"Atkinson Hyperlegible", Inter, ui-sans-serif, system-ui, sans-serif',
    )
    expect(style.getPropertyValue(FONT_SIZE_UI_VARIABLE)).toBe('14.5px')

    expect(document.documentElement.getAttribute(APPEARANCE_THEME_ATTRIBUTE)).toBe('mint-panel')
    expect(document.documentElement.getAttribute(APPEARANCE_MODE_ATTRIBUTE)).toBe('light')
    expect(document.documentElement.getAttribute(APPEARANCE_REVISION_ATTRIBUTE)).toBe('3')
    expect(document.documentElement.hasAttribute(APPEARANCE_PREVIEW_ATTRIBUTE)).toBe(false)
  })

  it('removes glass variables and the scope attribute when glass is off', () => {
    const appearance = resolveEffectiveAppearance({
      colorMode: 'light',
      theme: customTheme,
    })
    applyEffectiveAppearance(document.documentElement, appearance, {
      revision: 1,
      previewing: false,
    })
    expect(document.documentElement.style.getPropertyValue(GLASS_BLUR_VARIABLE)).toBe('')
    expect(document.documentElement.hasAttribute(APPEARANCE_GLASS_ATTRIBUTE)).toBe(false)
  })

  it('marks preview applications with the preview attribute', () => {
    const appearance = resolveEffectiveAppearance({
      colorMode: 'light',
      theme: customTheme,
    })
    applyEffectiveAppearance(document.documentElement, appearance, {
      revision: 4,
      previewing: true,
    })
    expect(document.documentElement.getAttribute(APPEARANCE_PREVIEW_ATTRIBUTE)).toBe('true')
  })

  it('clears every allowlisted variable but keeps data attributes intact', () => {
    const appearance = resolveEffectiveAppearance({
      colorMode: 'light',
      theme: customTheme,
    })
    applyEffectiveAppearance(document.documentElement, appearance, {
      revision: 1,
      previewing: false,
    })
    clearAppearanceVariables(document.documentElement)

    const style = document.documentElement.style
    expect(style.getPropertyValue('--background')).toBe('')
    expect(style.getPropertyValue('--sidebar-ring')).toBe('')
    expect(style.getPropertyValue(CANVAS_IMAGE_VARIABLE)).toBe('')
    expect(style.getPropertyValue(GLASS_BLUR_VARIABLE)).toBe('')
    expect(style.getPropertyValue(FONT_UI_VARIABLE)).toBe('')
    expect(document.documentElement.getAttribute(APPEARANCE_THEME_ATTRIBUTE)).toBe('mint-panel')
  })

  it('removes data attributes on teardown', () => {
    const appearance = resolveEffectiveAppearance({
      colorMode: 'light',
      theme: customTheme,
    })
    applyEffectiveAppearance(document.documentElement, appearance, {
      revision: 1,
      previewing: true,
    })
    clearAppearanceAttributes(document.documentElement)
    expect(document.documentElement.getAttribute(APPEARANCE_THEME_ATTRIBUTE)).toBeNull()
    expect(document.documentElement.getAttribute(APPEARANCE_MODE_ATTRIBUTE)).toBeNull()
    expect(document.documentElement.getAttribute(APPEARANCE_REVISION_ATTRIBUTE)).toBeNull()
    expect(document.documentElement.hasAttribute(APPEARANCE_PREVIEW_ATTRIBUTE)).toBe(false)
    expect(document.documentElement.hasAttribute(APPEARANCE_GLASS_ATTRIBUTE)).toBe(false)
  })

  it('clears overrides when the CSS-default built-in theme is applied', () => {
    const custom = resolveEffectiveAppearance({ colorMode: 'light', theme: customTheme })
    applyEffectiveAppearance(document.documentElement, custom, {
      revision: 1,
      previewing: false,
    })
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#f0fff8')

    const builtIn = resolveEffectiveAppearance({ colorMode: 'light' })
    expect(builtIn.themeId).toBe(BUILTIN_VIXL_THEME_ID)
    expect(builtIn.usesCssDefaults).toBe(true)
    applyEffectiveAppearance(document.documentElement, builtIn, {
      revision: 2,
      previewing: false,
    })
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('')
    expect(document.documentElement.style.getPropertyValue(CANVAS_IMAGE_VARIABLE)).toBe('')
    expect(document.documentElement.getAttribute(APPEARANCE_THEME_ATTRIBUTE)).toBe(
      BUILTIN_VIXL_THEME_ID,
    )
  })
})
