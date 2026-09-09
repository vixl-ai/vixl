/**
 * Versioned appearance theme domain model (format version 2).
 *
 * Themes are data-only: semantic colors, canvas backgrounds (solid fallback
 * plus bounded layered linear/radial/conic gradients), per-variant glass
 * surface configuration, per-variant icon appearance, typography, and editor
 * palettes. No raw CSS, URLs, remote assets, images, or font sources.
 */

/** Version of the canonical theme domain and shareable file format. */
export const VIXL_THEME_FORMAT_VERSION = 2

/** Reserved id for the unstored built-in Vixl default theme. */
export const BUILTIN_VIXL_THEME_ID = 'vixl-default'

export type VixlThemeVariantKind = 'light' | 'dark'

export type VixlThemeSemanticTokens = {
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  border: string
  input: string
  ring: string
  sidebar: string
  sidebarForeground: string
  sidebarPrimary: string
  sidebarPrimaryForeground: string
  sidebarAccent: string
  sidebarAccentForeground: string
  sidebarBorder: string
  sidebarRing: string
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
}

/** Version-1 canvas background (solid or single linear gradient). */
export type VixlThemeCanvasBackgroundV1 =
  | { type: 'solid'; color: string }
  | {
      type: 'gradient'
      /** CSS gradient angle in degrees, 0-360. */
      angle: number
      /** 2-5 stops with positions in 0-100, sorted ascending. */
      stops: Array<{ color: string; position: number }>
      /** Solid color used when gradients are not renderable. */
      fallback?: string
    }

/** One gradient color stop: safe hex (alpha-capable) plus a 0-100 position. */
export type VixlThemeGradientStop = {
  color: string
  position: number
}

/** Bounded radial gradient extent keywords (no explicit lengths or shapes). */
export const THEME_RADIAL_SIZES = [
  'closest-side',
  'closest-corner',
  'farthest-side',
  'farthest-corner',
] as const

export type VixlThemeRadialSize = (typeof THEME_RADIAL_SIZES)[number]

/**
 * One ordered canvas background layer. Geometry is bounded and normalized:
 * angles in degrees (0-360), radial/conic origins as 0-100 percent pairs, and
 * 2-6 stops sorted by ascending position. Layers never carry raw CSS, URLs,
 * or image data.
 */
export type VixlThemeCanvasLayer =
  | {
      kind: 'linear'
      angle: number
      stops: VixlThemeGradientStop[]
    }
  | {
      kind: 'radial'
      /** Horizontal center in percent (0-100). */
      x: number
      /** Vertical center in percent (0-100). */
      y: number
      size: VixlThemeRadialSize
      stops: VixlThemeGradientStop[]
    }
  | {
      kind: 'conic'
      /** Start angle in degrees (0-360), measured from the top. */
      angle: number
      /** Horizontal origin in percent (0-100). */
      x: number
      /** Vertical origin in percent (0-100). */
      y: number
      stops: VixlThemeGradientStop[]
    }

/**
 * Version-2 app canvas: an explicit solid fallback color plus up to four
 * ordered background layers painted over it (first layer on top).
 */
export type VixlThemeCanvas = {
  /** Solid color used when layers are absent or not renderable. */
  fallback: string
  /** 0-4 ordered layers; earlier layers paint above later ones. */
  layers: VixlThemeCanvasLayer[]
}

/** Surfaces a glass configuration can apply to. */
export const THEME_GLASS_SCOPES = ['sidebar', 'panels', 'overlays'] as const

export type VixlThemeGlassScope = (typeof THEME_GLASS_SCOPES)[number]

export const THEME_GLASS_SHADOW_PRESETS = ['none', 'subtle', 'medium', 'strong'] as const

export type VixlThemeGlassShadowPreset = (typeof THEME_GLASS_SHADOW_PRESETS)[number]

export const THEME_GLASS_RADIUS_PRESETS = ['none', 'sm', 'md', 'lg'] as const

export type VixlThemeGlassRadiusPreset = (typeof THEME_GLASS_RADIUS_PRESETS)[number]

/**
 * Per-variant glass surface configuration. Data-only: opacity/blur/saturation
 * are bounded numbers the runtime maps into allowlisted CSS variables, never
 * arbitrary filter or shadow values.
 */
export type VixlThemeGlass = {
  /** Master switch; disabled glass renders opaque semantic surfaces. */
  enabled: boolean
  /** Which top-level surface groups opt into the effect. */
  scopes: VixlThemeGlassScope[]
  /** Surface fill opacity in percent (0-100); lower is more translucent. */
  surfaceOpacity: number
  /** Backdrop blur radius in px (bounded). */
  blur: number
  /** Backdrop saturation in percent (100 = neutral). */
  saturation: number
  /** Glass border opacity in percent (0-100). */
  borderOpacity: number
  /** Named, allowlisted shadow strength. */
  shadow: VixlThemeGlassShadowPreset
  /** Named, allowlisted corner-radius strength. */
  radius: VixlThemeGlassRadiusPreset
}

/** Bundled, allowlisted icon packs. Themes store the pack id only. */
export const THEME_ICON_PACKS = ['lucide', 'tabler', 'phosphor'] as const

export type VixlThemeIconPack = (typeof THEME_ICON_PACKS)[number]

/**
 * Icon tint: either inherit the surrounding `currentColor` (default) or one
 * safe hex color (alpha-capable).
 */
export type VixlThemeIconTint = 'inherit' | string

/**
 * Per-variant icon appearance. Weight is a normalized stroke-width value and
 * size scale a bounded multiplier applied to the intrinsic icon size.
 */
export type VixlThemeIconAppearance = {
  pack: VixlThemeIconPack
  /** Normalized stroke weight (bounded). */
  weight: number
  /** Size multiplier applied to the intrinsic icon size (bounded). */
  sizeScale: number
  /** `inherit` keeps `currentColor`; otherwise a safe hex color. */
  tint: VixlThemeIconTint
}

export type VixlThemeTypography = {
  /** Primary UI font family name, e.g. "Inter Variable". */
  uiFontFamily: string
  /** Explicit system/bundled fallback stacks applied after uiFontFamily. */
  uiFontFallbacks: string[]
  monoFontFamily: string
  monoFontFallbacks: string[]
  uiFontSize: number
  editorFontSize: number
}

/** Editor/code colors shared by Monaco and Shiki for one variant. */
export type VixlThemeEditorPalette = {
  background: string
  foreground: string
  comment: string
  keyword: string
  keywordAccent: string
  string: string
  number: string
  function: string
  type: string
  variable: string
  constant: string
  operator: string
  invalid: string
  regexp: string
  attribute: string
  tag: string
  escape: string
  hoverWidgetBackground: string
  hoverWidgetForeground: string
  hoverWidgetBorder: string
  suggestWidgetBackground: string
  suggestWidgetForeground: string
  suggestWidgetBorder: string
}

export type VixlThemeVariant = {
  colors: VixlThemeSemanticTokens
  canvas: VixlThemeCanvas
  glass: VixlThemeGlass
  icons: VixlThemeIconAppearance
  typography: VixlThemeTypography
  editor: VixlThemeEditorPalette
}

export type VixlThemeDefinition = {
  /** Stable identifier. Reserved built-in ids are never stored. */
  id: string
  /** User-facing display name. */
  name: string
  version: number
  variants: {
    light: VixlThemeVariant
    dark: VixlThemeVariant
  }
}

/** A theme as stored in the personal settings theme library. */
export type VixlThemeLibraryEntry = VixlThemeDefinition
