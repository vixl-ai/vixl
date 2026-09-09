import { describe, expect, it } from 'vitest'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import {
  canvasToCss,
  clampAngle,
  clampFontSize,
  clampStopPosition,
  contrastRatio,
  contrastTargetFor,
  contrastWarnings,
  fontStackCss,
  hasInsufficientContrast,
  isBuiltInTheme,
  isValidHexColor,
  typographyPresetValue,
} from '@/components/settings/appearance/appearance-ui'

describe('appearance-ui helpers', () => {
  it('validates safe hex colors only', () => {
    expect(isValidHexColor('#fff')).toBe(true)
    expect(isValidHexColor('#1a1a1a')).toBe(true)
    expect(isValidHexColor('#1a1a1a80')).toBe(true)
    expect(isValidHexColor('rgb(0,0,0)')).toBe(false)
    expect(isValidHexColor('#12345')).toBe(false)
    expect(isValidHexColor('#1a1a1a; url(x)')).toBe(false)
  })

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(hasInsufficientContrast('#ffffff', '#ffffff')).toBe(true)
    expect(hasInsufficientContrast('#0a0a0a', '#ffffff')).toBe(false)
  })

  it('warns on low-contrast token pairs and keeps values', () => {
    const tokens = {
      ...builtInVixlTheme.variants.light.colors,
      foreground: '#cccccc',
      mutedForeground: '#dddddd',
    }
    const warnings = contrastWarnings(tokens)
    expect(warnings.some((warning) => warning.label === 'Text on background')).toBe(true)
    expect(warnings.some((warning) => warning.label === 'Muted text on background')).toBe(true)
  })

  it('does not warn on the built-in light palette', () => {
    expect(contrastWarnings(builtInVixlTheme.variants.light.colors)).toHaveLength(0)
  })

  it('pairs foreground tokens with their semantic background', () => {
    const tokens = builtInVixlTheme.variants.light.colors
    expect(contrastTargetFor('cardForeground', tokens)).toBe(tokens.card)
    expect(contrastTargetFor('foreground', tokens)).toBe(tokens.background)
    expect(contrastTargetFor('border', tokens)).toBeUndefined()
  })

  it('renders structured canvas backgrounds as CSS', () => {
    expect(canvasToCss({ fallback: '#101010', layers: [] })).toBe('#101010')
    const gradientCss = canvasToCss({
      fallback: '#000000',
      layers: [
        {
          kind: 'linear',
          angle: 45,
          stops: [
            { color: '#ff0000', position: 100 },
            { color: '#0000ff', position: 0 },
          ],
        },
      ],
    })
    expect(gradientCss).toBe('linear-gradient(45deg, #0000ff 0%, #ff0000 100%), #000000')
  })

  it('clamps values into schema-safe ranges', () => {
    expect(clampFontSize(5)).toBe(8)
    expect(clampFontSize(40)).toBe(32)
    expect(clampFontSize(13.4)).toBe(13.5)
    expect(clampAngle(450)).toBe(90)
    expect(clampAngle(-45)).toBe(315)
    expect(clampStopPosition(140)).toBe(100)
    expect(clampStopPosition(-5)).toBe(0)
  })

  it('maps typography to preset values and font stacks', () => {
    const typography = builtInVixlTheme.variants.light.typography
    expect(typographyPresetValue(typography, 'ui')).toBe(
      'Inter Variable|Inter,ui-sans-serif,system-ui,sans-serif',
    )
    expect(fontStackCss(typography, 'ui')).toBe(
      'Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif',
    )
    expect(fontStackCss(typography, 'mono')).toBe('JetBrains Mono, ui-monospace, Menlo, monospace')
  })

  it('identifies the built-in theme', () => {
    expect(isBuiltInTheme(builtInVixlTheme)).toBe(true)
    expect(isBuiltInTheme({ ...builtInVixlTheme, id: 'custom-theme' })).toBe(false)
  })
})
