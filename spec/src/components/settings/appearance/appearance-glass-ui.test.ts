import { describe, expect, it } from 'vitest'
import { BUILTIN_GLASS_DISABLED, builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import type { VixlThemeGlass, VixlThemeSemanticTokens } from '@/types/appearance/theme'
import {
  GLASS_PRESETS,
  clampGlassBlur,
  clampGlassBorderOpacity,
  clampGlassOpacity,
  clampGlassSaturation,
  glassPresetIdFor,
  glassSurfaceStyle,
  glassTranslucencyWarnings,
  normalizeGlassScopes,
  sanitizeGlass,
} from '@/components/settings/appearance/appearance-glass-ui'

const tokens: VixlThemeSemanticTokens = builtInVixlTheme.variants.light.colors

const enabledGlass = (overrides: Partial<VixlThemeGlass> = {}): VixlThemeGlass => ({
  enabled: true,
  scopes: ['sidebar', 'panels', 'overlays'],
  surfaceOpacity: 70,
  blur: 16,
  saturation: 130,
  borderOpacity: 70,
  shadow: 'medium',
  radius: 'lg',
  ...overrides,
})

describe('glass clamps', () => {
  it('clamps opacity and border opacity to 0-100', () => {
    expect(clampGlassOpacity(-5)).toBe(0)
    expect(clampGlassOpacity(150)).toBe(100)
    expect(clampGlassOpacity(42.6)).toBe(43)
    expect(clampGlassBorderOpacity(-1)).toBe(0)
    expect(clampGlassBorderOpacity(999)).toBe(100)
  })

  it('clamps blur to the schema bound and saturation to the schema range', () => {
    expect(clampGlassBlur(-10)).toBe(0)
    expect(clampGlassBlur(48)).toBe(48)
    expect(clampGlassBlur(120)).toBe(48)
    expect(clampGlassSaturation(50)).toBe(100)
    expect(clampGlassSaturation(500)).toBe(200)
    expect(clampGlassSaturation(140)).toBe(140)
  })

  it('falls back to safe defaults for non-finite values', () => {
    expect(clampGlassOpacity(Number.NaN)).toBe(0)
    expect(clampGlassBlur(Number.NaN)).toBe(0)
    expect(clampGlassSaturation(Number.NaN)).toBe(100)
  })
})

describe('sanitizeGlass', () => {
  it('keeps valid values and normalizes scope order', () => {
    const glass = sanitizeGlass(
      enabledGlass({ scopes: ['overlays', 'sidebar', 'panels', 'overlays'] }),
    )
    expect(glass.scopes).toEqual(['sidebar', 'panels', 'overlays'])
  })

  it('clamps out-of-range numbers and drops invalid presets', () => {
    const glass = sanitizeGlass({
      enabled: true,
      scopes: ['panels'],
      surfaceOpacity: 200,
      blur: 999,
      saturation: 10,
      borderOpacity: -3,
      shadow: 'huge' as VixlThemeGlass['shadow'],
      radius: 'xl' as VixlThemeGlass['radius'],
    })
    expect(glass).toEqual({
      enabled: true,
      scopes: ['panels'],
      surfaceOpacity: 100,
      blur: 48,
      saturation: 100,
      borderOpacity: 0,
      shadow: 'none',
      radius: 'none',
    })
  })

  it('clears scopes when disabled', () => {
    const glass = sanitizeGlass(enabledGlass({ enabled: false, scopes: ['panels'] }))
    expect(glass.scopes).toEqual([])
  })
})

describe('glass presets', () => {
  it('matches each preset for its exact values', () => {
    for (const preset of GLASS_PRESETS) {
      expect(glassPresetIdFor(preset.glass)).toBe(preset.id)
    }
  })

  it('matches Off regardless of stored scopes when disabled', () => {
    expect(glassPresetIdFor({ ...BUILTIN_GLASS_DISABLED, scopes: ['panels'] })).toBe('off')
  })

  it('returns null for custom values', () => {
    expect(glassPresetIdFor(enabledGlass({ blur: 12 }))).toBeNull()
  })

  it('keeps every preset within the strict schema bounds', () => {
    for (const preset of GLASS_PRESETS) {
      expect(preset.glass.blur).toBeLessThanOrEqual(48)
      expect(preset.glass.surfaceOpacity).toBeGreaterThanOrEqual(0)
      expect(preset.glass.surfaceOpacity).toBeLessThanOrEqual(100)
      expect(normalizeGlassScopes(preset.glass.scopes)).toEqual(preset.glass.scopes)
    }
  })
})

describe('glassSurfaceStyle', () => {
  it('returns empty styles when glass is disabled or the scope is off', () => {
    expect(glassSurfaceStyle(enabledGlass({ enabled: false }), 'panels', tokens)).toEqual({})
    expect(glassSurfaceStyle(enabledGlass({ scopes: ['panels'] }), 'overlays', tokens)).toEqual({})
  })

  it('builds bounded color-mix and backdrop-filter values for a scope', () => {
    const style = glassSurfaceStyle(enabledGlass(), 'panels', tokens)
    expect(style.backgroundColor).toBe(`color-mix(in srgb, ${tokens.card} 70%, transparent)`)
    expect(style.borderColor).toBe(`color-mix(in srgb, ${tokens.border} 70%, transparent)`)
    expect(style.backdropFilter).toBe('blur(16px) saturate(130%)')
    expect(style.boxShadow).toBeTruthy()
    expect(style.borderRadius).toBeTruthy()
  })

  it('uses sidebar tokens and skips rounding for the sidebar scope', () => {
    const style = glassSurfaceStyle(enabledGlass(), 'sidebar', tokens)
    expect(style.backgroundColor).toContain(tokens.sidebar)
    expect(style.borderColor).toContain(tokens.sidebarBorder)
    expect(style.borderRadius).toBeUndefined()
  })

  it('uses popover tokens for the overlay scope', () => {
    const style = glassSurfaceStyle(enabledGlass(), 'overlays', tokens)
    expect(style.backgroundColor).toContain(tokens.popover)
    expect(style.borderRadius).toBeTruthy()
  })
})

describe('glassTranslucencyWarnings', () => {
  it('returns nothing when glass is off', () => {
    expect(glassTranslucencyWarnings(enabledGlass({ enabled: false }))).toEqual([])
    expect(glassTranslucencyWarnings(enabledGlass({ scopes: [] }))).toEqual([])
  })

  it('warns on very translucent surfaces without changing values', () => {
    const warnings = glassTranslucencyWarnings(enabledGlass({ surfaceOpacity: 40, blur: 8 }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('40%')
  })

  it('warns on very high blur', () => {
    const warnings = glassTranslucencyWarnings(enabledGlass({ surfaceOpacity: 90, blur: 40 }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('blur')
  })
})
