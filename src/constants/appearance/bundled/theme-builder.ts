import {
  BUILTIN_UI_TYPOGRAPHY,
  BUILTIN_ICONS_DEFAULT,
  builtInVixlTheme,
} from '@/constants/appearance/built-in-theme'
import type {
  VixlThemeCanvas,
  VixlThemeDefinition,
  VixlThemeEditorPalette,
  VixlThemeGlass,
  VixlThemeIconAppearance,
  VixlThemeSemanticTokens,
  VixlThemeVariant,
  VixlThemeVariantKind,
} from '@/types/appearance/theme'

/**
 * Builder for curated bundled theme definitions.
 *
 * Curated themes are authored as focused overrides over the neutral built-in
 * base so every variant always carries the complete, schema-valid v2 shape
 * (all semantic tokens, editor palette keys, typography, canvas, glass, and
 * icon appearance). Palettes are original compositions inspired generically
 * by well-known aesthetic families; nothing is copied from third-party
 * themes.
 *
 * Editor hover/suggest widget colors default to the variant's own card,
 * popover, and border tokens so code widgets always match the theme surfaces.
 */

/** Focused overrides for one variant of a curated theme. */
export type BundledVariantSpec = {
  /** Semantic token overrides merged over the built-in base variant. */
  colors: Partial<VixlThemeSemanticTokens>
  /** Editor palette overrides; widget colors default to the theme surfaces. */
  editor?: Partial<VixlThemeEditorPalette>
  canvas: VixlThemeCanvas
  glass: VixlThemeGlass
  /** Icon appearance overrides; defaults to Lucide/inherit/current sizing. */
  icons?: Partial<VixlThemeIconAppearance>
}

/** Compact authoring spec for one curated bundled theme. */
export type BundledThemeSpec = {
  id: string
  name: string
  light: BundledVariantSpec
  dark: BundledVariantSpec
}

const variantFor = (kind: VixlThemeVariantKind, spec: BundledVariantSpec): VixlThemeVariant => {
  const base = builtInVixlTheme.variants[kind]
  const colors: VixlThemeSemanticTokens = { ...base.colors, ...spec.colors }
  const editor: VixlThemeEditorPalette = {
    ...base.editor,
    ...spec.editor,
    hoverWidgetBackground: spec.editor?.hoverWidgetBackground ?? colors.card,
    hoverWidgetForeground: spec.editor?.hoverWidgetForeground ?? colors.foreground,
    hoverWidgetBorder: spec.editor?.hoverWidgetBorder ?? colors.border,
    suggestWidgetBackground: spec.editor?.suggestWidgetBackground ?? colors.popover,
    suggestWidgetForeground: spec.editor?.suggestWidgetForeground ?? colors.popoverForeground,
    suggestWidgetBorder: spec.editor?.suggestWidgetBorder ?? colors.border,
  }
  return {
    colors,
    canvas: spec.canvas,
    glass: spec.glass,
    icons: { ...BUILTIN_ICONS_DEFAULT, ...spec.icons },
    typography: BUILTIN_UI_TYPOGRAPHY,
    editor,
  }
}

/** Build a complete, immutable-shaped v2 theme definition from a spec. */
export const makeBundledTheme = (spec: BundledThemeSpec): VixlThemeDefinition => ({
  id: spec.id,
  name: spec.name,
  version: 2,
  variants: {
    light: variantFor('light', spec.light),
    dark: variantFor('dark', spec.dark),
  },
})

/** Glass configuration helper (percent/px values are schema-bounded). */
export const bundledGlass = (
  scopes: VixlThemeGlass['scopes'],
  values: Partial<Omit<VixlThemeGlass, 'scopes'>> = {},
): VixlThemeGlass => ({
  enabled: scopes.length > 0,
  scopes,
  surfaceOpacity: 60,
  blur: 20,
  saturation: 120,
  borderOpacity: 20,
  shadow: 'subtle',
  radius: 'md',
  ...values,
})

/** Glass configuration for curated themes without any transparency. */
export const bundledGlassOff: VixlThemeGlass = {
  enabled: false,
  scopes: [],
  surfaceOpacity: 100,
  blur: 0,
  saturation: 100,
  borderOpacity: 0,
  shadow: 'none',
  radius: 'none',
}

/** Icon appearance helper over the Lucide default. */
export const bundledIcons = (
  overrides: Partial<VixlThemeIconAppearance> = {},
): Partial<VixlThemeIconAppearance> => overrides

/** Stop list helper: color/position pairs in ascending order. */
export const stops = (...entries: Array<[string, number]>) =>
  entries.map(([color, position]) => ({ color, position }))
