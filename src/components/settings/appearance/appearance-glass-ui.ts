import {
  THEME_GLASS_BLUR_MAX,
  THEME_GLASS_SATURATION_MAX,
  THEME_GLASS_SATURATION_MIN,
} from '@/schemas/appearance/theme'
import {
  THEME_GLASS_RADIUS_PRESETS,
  THEME_GLASS_SCOPES,
  THEME_GLASS_SHADOW_PRESETS,
  type VixlThemeGlass,
  type VixlThemeGlassRadiusPreset,
  type VixlThemeGlassScope,
  type VixlThemeGlassShadowPreset,
  type VixlThemeSemanticTokens,
} from '@/types/appearance/theme'
import { BUILTIN_GLASS_DISABLED } from '@/constants/appearance/built-in-theme'
import {
  GLASS_RADIUS_PRESET_VALUES,
  GLASS_SHADOW_PRESET_VALUES,
} from '@/utils/appearance/appearance-css'

/**
 * UI helpers for the Appearance glass-surface editor, layered on the v2 glass
 * domain (types, schema bounds, and the runtime CSS preset values).
 */

export type GlassPresetId = 'off' | 'subtle' | 'frosted' | 'crystal'

export type GlassPreset = {
  id: GlassPresetId
  label: string
  description: string
  glass: VixlThemeGlass
}

/**
 * Bounded presets. Every value satisfies the strict v2 glass schema, so
 * applying a preset can never produce an invalid draft.
 */
export const GLASS_PRESETS: GlassPreset[] = [
  {
    id: 'off',
    label: 'Off',
    description: 'Opaque semantic surfaces, no blur',
    glass: { ...BUILTIN_GLASS_DISABLED },
  },
  {
    id: 'subtle',
    label: 'Subtle',
    description: 'Slightly translucent panels only',
    glass: {
      enabled: true,
      scopes: ['panels'],
      surfaceOpacity: 88,
      blur: 8,
      saturation: 110,
      borderOpacity: 60,
      shadow: 'subtle',
      radius: 'md',
    },
  },
  {
    id: 'frosted',
    label: 'Frosted',
    description: 'Classic frosted sidebar, panels, and overlays',
    glass: {
      enabled: true,
      scopes: ['sidebar', 'panels', 'overlays'],
      surfaceOpacity: 70,
      blur: 16,
      saturation: 130,
      borderOpacity: 70,
      shadow: 'medium',
      radius: 'lg',
    },
  },
  {
    id: 'crystal',
    label: 'Crystal',
    description: 'Highly translucent with strong blur',
    glass: {
      enabled: true,
      scopes: ['sidebar', 'panels', 'overlays'],
      surfaceOpacity: 45,
      blur: 32,
      saturation: 160,
      borderOpacity: 80,
      shadow: 'strong',
      radius: 'lg',
    },
  },
]

export const GLASS_SCOPE_LABELS: Record<VixlThemeGlassScope, string> = {
  sidebar: 'Sidebar',
  panels: 'Panels and cards',
  overlays: 'Dialogs, popovers, and toasts',
}

const clampPercent = (value: number): number =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0

export const clampGlassOpacity = clampPercent
export const clampGlassBorderOpacity = clampPercent

export const clampGlassBlur = (value: number): number =>
  Number.isFinite(value) ? Math.min(THEME_GLASS_BLUR_MAX, Math.max(0, Math.round(value))) : 0

export const clampGlassSaturation = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(THEME_GLASS_SATURATION_MAX, Math.max(THEME_GLASS_SATURATION_MIN, Math.round(value)))
    : THEME_GLASS_SATURATION_MIN

/** Deduplicated scopes in canonical order. */
export const normalizeGlassScopes = (
  scopes: readonly VixlThemeGlassScope[],
): VixlThemeGlassScope[] => THEME_GLASS_SCOPES.filter((scope) => scopes.includes(scope))

const isShadowPreset = (value: unknown): value is VixlThemeGlassShadowPreset =>
  (THEME_GLASS_SHADOW_PRESETS as readonly unknown[]).includes(value)

const isRadiusPreset = (value: unknown): value is VixlThemeGlassRadiusPreset =>
  (THEME_GLASS_RADIUS_PRESETS as readonly unknown[]).includes(value)

/**
 * Coerce arbitrary (user-input) glass values into a schema-safe glass config.
 * Out-of-range numbers clamp, invalid scopes/presets fall back to safe
 * defaults, and scope order is canonical so drafts round-trip the strict v2
 * schema.
 */
export const sanitizeGlass = (glass: VixlThemeGlass): VixlThemeGlass => ({
  enabled: glass.enabled === true,
  scopes: glass.enabled ? normalizeGlassScopes(glass.scopes ?? []) : [],
  surfaceOpacity: clampGlassOpacity(glass.surfaceOpacity),
  blur: clampGlassBlur(glass.blur),
  saturation: clampGlassSaturation(glass.saturation),
  borderOpacity: clampGlassBorderOpacity(glass.borderOpacity),
  shadow: isShadowPreset(glass.shadow) ? glass.shadow : 'none',
  radius: isRadiusPreset(glass.radius) ? glass.radius : 'none',
})

const sameGlass = (a: VixlThemeGlass, b: VixlThemeGlass): boolean =>
  JSON.stringify(sanitizeGlass(a)) === JSON.stringify(sanitizeGlass(b))

/**
 * Returns the preset matching a glass configuration, or null for custom
 * values. Disabled glass always matches the Off preset regardless of stored
 * scope values.
 */
export const glassPresetIdFor = (glass: VixlThemeGlass): GlassPresetId | null => {
  for (const preset of GLASS_PRESETS) {
    if (sameGlass(preset.glass, glass)) {
      return preset.id
    }
  }
  return null
}

/** Semantic base/border tokens behind each glass scope. */
const scopeTokens = (
  scope: VixlThemeGlassScope,
): { surface: keyof VixlThemeSemanticTokens; border: keyof VixlThemeSemanticTokens } =>
  scope === 'sidebar'
    ? { surface: 'sidebar', border: 'sidebarBorder' }
    : scope === 'panels'
      ? { surface: 'card', border: 'border' }
      : { surface: 'popover', border: 'border' }

/**
 * Inline preview styles for one glass scope, mirroring the runtime
 * `glass-surface-*` CSS utilities (semantic base colors via color-mix plus
 * bounded blur/saturation). Empty when glass is disabled or the scope is off,
 * so previews fall back to the opaque semantic surface styles.
 */
export const glassSurfaceStyle = (
  glass: VixlThemeGlass,
  scope: VixlThemeGlassScope,
  tokens: VixlThemeSemanticTokens,
): Record<string, string> => {
  if (!glass.enabled || !glass.scopes.includes(scope)) {
    return {}
  }
  const { surface, border } = scopeTokens(scope)
  const style: Record<string, string> = {
    backgroundColor: `color-mix(in srgb, ${tokens[surface]} ${clampGlassOpacity(glass.surfaceOpacity)}%, transparent)`,
    borderColor: `color-mix(in srgb, ${tokens[border]} ${clampGlassBorderOpacity(glass.borderOpacity)}%, transparent)`,
    boxShadow: GLASS_SHADOW_PRESET_VALUES[glass.shadow],
    backdropFilter: `blur(${clampGlassBlur(glass.blur)}px) saturate(${clampGlassSaturation(glass.saturation)}%)`,
  }
  // The sidebar is a flush full-height shell and never takes glass rounding.
  if (scope !== 'sidebar') {
    style.borderRadius = GLASS_RADIUS_PRESET_VALUES[glass.radius]
  }
  return style
}

/**
 * Warnings for translucent settings that can undermine text contrast or
 * performance. Warnings never modify the user's chosen values.
 */
export const glassTranslucencyWarnings = (glass: VixlThemeGlass): string[] => {
  if (!glass.enabled || glass.scopes.length === 0) {
    return []
  }
  const warnings: string[] = []
  if (glass.surfaceOpacity < 55) {
    warnings.push(
      `Surface opacity ${glass.surfaceOpacity}% is very translucent; text over glass may fail contrast on busy backgrounds.`,
    )
  }
  if (glass.blur > 24) {
    warnings.push('High blur values may reduce performance on low-end GPUs.')
  }
  return warnings
}
