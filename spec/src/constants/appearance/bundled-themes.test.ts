import { describe, expect, it } from 'vitest'
import {
  BUNDLED_THEMES,
  getBuiltinThemeDefinition,
  getBuiltinThemeMeta,
  RESERVED_CURATED_BUILTIN_THEME_IDS,
} from '@/constants/appearance/built-in-theme-registry'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import { themeVariantSchema } from '@/schemas/appearance/theme'
import { contrastWarnings } from '@/components/settings/appearance/appearance-ui'
import type { VixlThemeDefinition } from '@/types/appearance/theme'

/**
 * Bundled-theme registry invariants: the default plus the eight curated
 * themes must be complete v2 definitions with stable unique reserved ids,
 * schema-valid variants, and reviewed text contrast in both variants.
 */

const curated = (): VixlThemeDefinition[] => BUNDLED_THEMES.filter((theme) => theme.id !== 'vixl-default')

describe('bundled theme registry invariants', () => {
  it('ships exactly the default plus eight curated themes in stable order', () => {
    expect(BUNDLED_THEMES).toHaveLength(9)
    expect(BUNDLED_THEMES[0]).toBe(builtInVixlTheme)
    expect(curated().map((theme) => theme.id)).toEqual([...RESERVED_CURATED_BUILTIN_THEME_IDS])
  })

  it('keeps ids unique, reserved, and metadata in sync', () => {
    const ids = BUNDLED_THEMES.map((theme) => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const theme of BUNDLED_THEMES) {
      const meta = getBuiltinThemeMeta(theme.id)
      expect(meta).not.toBeNull()
      expect(meta?.name).toBe(theme.name)
      expect(meta?.readOnlyBuiltIn).toBe(true)
    }
    expect(getBuiltinThemeMeta('vixl-default')?.usesCssDefaults).toBe(true)
    for (const theme of curated()) {
      expect(getBuiltinThemeMeta(theme.id)?.usesCssDefaults).toBe(false)
    }
  })

  it('resolves every bundled definition by id and nothing else', () => {
    for (const theme of BUNDLED_THEMES) {
      expect(getBuiltinThemeDefinition(theme.id)).toBe(theme)
    }
    expect(getBuiltinThemeDefinition('not-a-bundled-theme')).toBeNull()
    expect(getBuiltinThemeDefinition('')).toBeNull()
  })

  it('provides complete schema-valid v2 variants for every theme', () => {
    for (const theme of BUNDLED_THEMES) {
      expect(theme.version).toBe(2)
      expect(theme.variants.light).toBeDefined()
      expect(theme.variants.dark).toBeDefined()
      expect(themeVariantSchema.safeParse(theme.variants.light).success).toBe(true)
      expect(themeVariantSchema.safeParse(theme.variants.dark).success).toBe(true)
    }
  })

  it('uses bundled icon packs with bounded appearance values', () => {
    for (const theme of BUNDLED_THEMES) {
      for (const variant of [theme.variants.light, theme.variants.dark]) {
        expect(['lucide', 'tabler', 'phosphor']).toContain(variant.icons.pack)
        expect(variant.icons.tint === 'inherit' || variant.icons.tint.startsWith('#')).toBe(true)
      }
    }
    // At least one curated theme exercises each non-default pack.
    const packs = new Set(curated().flatMap((theme) => [theme.variants.light.icons.pack, theme.variants.dark.icons.pack]))
    expect(packs.has('tabler')).toBe(true)
    expect(packs.has('phosphor')).toBe(true)
  })

  it('keeps curated glass configurations inside the accessibility fallbacks', () => {
    for (const theme of curated()) {
      for (const variant of [theme.variants.light, theme.variants.dark]) {
        const glass = variant.glass
        const scopeCount = glass.enabled ? glass.scopes.length : 0
        expect(scopeCount).toBeGreaterThanOrEqual(0)
        expect(glass.scopes.every((scope) => ['sidebar', 'panels', 'overlays'].includes(scope))).toBe(
          true,
        )
        expect(glass.blur).toBeLessThanOrEqual(48)
        expect(glass.surfaceOpacity).toBeGreaterThanOrEqual(0)
        expect(glass.enabled).toBe(glass.scopes.length > 0)
      }
    }
  })

  it('meets normal text contrast (4.5:1) in both variants of every theme', () => {
    const warnings: string[] = []
    for (const theme of BUNDLED_THEMES) {
      for (const kind of ['light', 'dark'] as const) {
        for (const warning of contrastWarnings(theme.variants[kind].colors)) {
          warnings.push(`${theme.id}/${kind}: ${warning.label} ${warning.ratio.toFixed(2)}`)
        }
      }
    }
    expect(warnings).toEqual([])
  })
})
