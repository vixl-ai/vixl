import type { ThemeDefinitionV1Parsed } from '@/schemas/appearance/theme-v1'
import type { ThemeFilePayload, ThemeFilePayloadV1 } from '@/schemas/appearance/theme-file'
import { themeFilePayloadSchema } from '@/schemas/appearance/theme-file'
import type {
  VixlThemeCanvas,
  VixlThemeCanvasBackgroundV1,
  VixlThemeCanvasLayer,
  VixlThemeDefinition,
  VixlThemeGlass,
  VixlThemeGradientStop,
  VixlThemeIconAppearance,
} from '@/types/appearance/theme'
import {
  BUILTIN_GLASS_DISABLED,
  BUILTIN_ICONS_DEFAULT,
} from '@/constants/appearance/built-in-theme'

/**
 * Pure v1 → v2 migrations for the appearance theme domain.
 *
 * The version-2 canonical model (layered canvas, glass, icons) replaces the
 * version-1 model (solid or single linear gradient). Both persisted library
 * entries and imported shareable files may still be v1; they are migrated
 * with exactly these pure functions instead of being dropped, and migrated
 * output must validate against the strict v2 schemas unchanged.
 *
 * Migration rules (visual-equivalence contract):
 * - Solid v1 canvases keep the same color as the v2 solid fallback with no
 *   layers.
 * - v1 linear gradients become exactly one v2 linear layer; the v2 fallback
 *   is the explicit v1 fallback when present, otherwise the first (lowest
 *   position) stop color — matching the v1 runtime, which painted gradients
 *   over the first stop color.
 * - Glass defaults to disabled; icon appearance defaults to the Lucide
 *   compatibility defaults (weight 2, size scale 1, inherit tint).
 * - Colors, typography, and editor palettes are copied unchanged.
 */

/** Disabled, fully opaque glass: the v1 behavior (no glass existed). */
export const migratedGlassDefaults = (): VixlThemeGlass => ({ ...BUILTIN_GLASS_DISABLED })

/** Lucide/inherit/current-sizing icon defaults: the v1 behavior. */
export const migratedIconDefaults = (): VixlThemeIconAppearance => ({ ...BUILTIN_ICONS_DEFAULT })

const sortedStops = (stops: readonly VixlThemeGradientStop[]): VixlThemeGradientStop[] =>
  [...stops].sort((a, b) => a.position - b.position)

/**
 * Convert a v1 canvas background into the v2 canvas. Returns the fallback
 * color and 0-1 layers; `fallbackColor` is used when the v1 background has
 * neither an explicit fallback nor any stops.
 */
export const migrateCanvasBackgroundV1 = (
  background: VixlThemeCanvasBackgroundV1,
  fallbackColor: string,
): VixlThemeCanvas => {
  if (background.type === 'solid') {
    return { fallback: background.color, layers: [] }
  }

  const stops = sortedStops(background.stops)
  const fallback = background.fallback ?? stops[0]?.color ?? fallbackColor

  const layers: VixlThemeCanvasLayer[] =
    stops.length >= 2
      ? [{ kind: 'linear', angle: background.angle, stops: stops.map((stop) => ({ ...stop })) }]
      : []

  return { fallback, layers }
}

/** Migrate one persisted v1 library entry into the canonical v2 shape. */
export const migrateThemeDefinitionV1 = (theme: ThemeDefinitionV1Parsed): VixlThemeDefinition => ({
  id: theme.id,
  name: theme.name,
  version: 2,
  variants: {
    light: {
      colors: theme.variants.light.colors,
      canvas: migrateCanvasBackgroundV1(
        theme.variants.light.canvas,
        theme.variants.light.colors.background,
      ),
      glass: migratedGlassDefaults(),
      icons: migratedIconDefaults(),
      typography: theme.variants.light.typography,
      editor: theme.variants.light.editor,
    },
    dark: {
      colors: theme.variants.dark.colors,
      canvas: migrateCanvasBackgroundV1(
        theme.variants.dark.canvas,
        theme.variants.dark.colors.background,
      ),
      glass: migratedGlassDefaults(),
      icons: migratedIconDefaults(),
      typography: theme.variants.dark.typography,
      editor: theme.variants.dark.editor,
    },
  },
})

/** Migrate one v1 shareable file payload into the canonical v2 file shape. */
export const migrateThemeFileV1 = (payload: ThemeFilePayloadV1): ThemeFilePayload => {
  const migrateVariant = (
    variant: ThemeFilePayloadV1['variants']['light'],
  ): ThemeFilePayload['variants']['light'] => {
    const background = variant.background
    const canvas = migrateCanvasBackgroundV1(
      background.kind === 'solid'
        ? { type: 'solid', color: background.color }
        : {
            type: 'gradient',
            angle: background.angle,
            stops: background.stops,
            fallback: background.fallback,
          },
      variant.tokens.background,
    )

    return {
      tokens: { ...variant.tokens },
      background: canvas,
      glass: migratedGlassDefaults(),
      icons: migratedIconDefaults(),
      editor: { ...variant.editor },
    }
  }

  const migrated: ThemeFilePayload = {
    format: payload.format,
    version: 2,
    id: payload.id,
    name: payload.name,
    typography: { ...payload.typography },
    variants: {
      light: migrateVariant(payload.variants.light),
      dark: migrateVariant(payload.variants.dark),
    },
  }

  // Defensive: migrated output must always satisfy the strict v2 file schema.
  const parsed = themeFilePayloadSchema.safeParse(migrated)
  if (!parsed.success) {
    throw new Error('v1 theme migration produced an invalid v2 theme')
  }
  return parsed.data
}
