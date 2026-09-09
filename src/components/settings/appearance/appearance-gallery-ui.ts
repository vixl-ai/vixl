import { canvasToCss } from './appearance-ui'
import { clampGlassOpacity } from './appearance-glass-ui'
import {
  THEME_GLASS_SCOPES,
  type VixlThemeCanvas,
  type VixlThemeDefinition,
  type VixlThemeGlass,
  type VixlThemeIconPack,
  type VixlThemeVariant,
} from '@/types/appearance/theme'

/**
 * Pure helpers for the visual theme gallery (grouped cards with light/dark
 * swatch thumbnails, glass badges, and icon-pack samples). Layered on the v2
 * appearance domain and the same serializers the runtime uses, so thumbnails
 * match what the app actually renders.
 */

/** Gallery grouping: immutable bundled themes versus personal themes. */
export type GalleryGroup = 'built-in' | 'custom'

/** One theme prepared for gallery rendering. */
export type GalleryTheme = {
  theme: VixlThemeDefinition
  group: GalleryGroup
  builtIn: boolean
}

/**
 * Groups bundled and personal themes for the gallery. Bundled order is
 * preserved (Vixl Default first, then curated); personal themes keep library
 * order.
 */
export const groupGalleryThemes = (
  bundled: readonly VixlThemeDefinition[],
  custom: readonly VixlThemeDefinition[],
): { builtIn: GalleryTheme[]; custom: GalleryTheme[] } => ({
  builtIn: bundled.map((theme) => ({ theme, group: 'built-in', builtIn: true })),
  custom: custom.map((theme) => ({ theme, group: 'custom', builtIn: false })),
})

/** Display labels for the allowlisted icon packs. */
export const ICON_PACK_LABELS: Record<VixlThemeIconPack, string> = {
  lucide: 'Lucide',
  tabler: 'Tabler',
  phosphor: 'Phosphor',
}

export const iconPackLabel = (pack: VixlThemeIconPack): string => ICON_PACK_LABELS[pack] ?? pack

/** Short badge text for a variant's glass configuration. */
export const glassBadgeLabel = (glass: VixlThemeGlass): string => {
  if (!glass.enabled || glass.scopes.length === 0) {
    return 'Glass off'
  }
  if (glass.scopes.length === THEME_GLASS_SCOPES.length) {
    return 'Glass on'
  }
  return `Glass: ${glass.scopes.join(', ')}`
}

/** One-line canvas summary for a badge row (kind names are deduplicated). */
export const canvasSummaryLabel = (canvas: VixlThemeCanvas): string => {
  const layers = canvas.layers ?? []
  if (layers.length === 0) {
    return 'Solid canvas'
  }
  const kinds = [...new Set(layers.map((layer) => layer.kind))]
  const plural = layers.length === 1 ? 'layer' : 'layers'
  return `${layers.length} gradient ${plural} (${kinds.join(', ')})`
}

/** Inline styles for one variant's mini app-window thumbnail. */
export type SwatchStyles = {
  /** Layered canvas treatment (same serializer as the runtime). */
  canvas: Record<string, string>
  sidebar: Record<string, string>
  panel: Record<string, string>
  accent: Record<string, string>
  text: Record<string, string>
}

/**
 * Builds representative thumbnail styles from the variant's real tokens and
 * canvas. Panels hint at glass by composing the configured surface opacity
 * over the semantic card color (no blur at thumbnail size).
 */
export const variantSwatchStyles = (variant: VixlThemeVariant): SwatchStyles => {
  const tokens = variant.colors
  const glass = variant.glass
  const glassPanels = glass.enabled && glass.scopes.includes('panels')
  return {
    canvas: { background: canvasToCss(variant.canvas) },
    sidebar: { backgroundColor: tokens.sidebar },
    panel: {
      backgroundColor: glassPanels
        ? `color-mix(in srgb, ${tokens.card} ${clampGlassOpacity(glass.surfaceOpacity)}%, transparent)`
        : tokens.card,
      borderColor: tokens.border,
    },
    accent: { backgroundColor: tokens.primary },
    text: { backgroundColor: tokens.foreground },
  }
}

/** Full accessible name for a gallery card's select control. */
export const themeCardAriaLabel = (
  theme: VixlThemeDefinition,
  group: GalleryGroup,
  active: boolean,
): string =>
  `${theme.name} (${group === 'built-in' ? 'built-in' : 'custom'} theme${active ? ', active' : ''})`
