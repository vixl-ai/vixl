import type {
  VixlThemeCanvas,
  VixlThemeDefinition,
  VixlThemeEditorPalette,
  VixlThemeGlass,
  VixlThemeIconAppearance,
  VixlThemeSemanticTokens,
  VixlThemeTypography,
  VixlThemeVariantKind,
} from '@/types/appearance/theme'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import { getBuiltinThemeMeta } from '@/constants/appearance/built-in-theme-registry'

/**
 * Pure effective-theme resolver.
 *
 * Combines the built-in Vixl default theme, the active saved theme from the
 * personal library, the resolved light/dark variant, and an optional
 * in-memory preview draft into one effective appearance object. The runtime
 * (`use-appearance.ts`) applies the result to the document and emits the
 * normalized appearance-change signal from it.
 */

/** User-facing color mode (`appearance.theme` semantics). */
export type VixlColorMode = 'light' | 'dark' | 'system'

/** In-memory preview draft applied by the runtime without persisting settings. */
export type AppearancePreviewDraft = {
  /** Force the previewed variant, overriding the resolved color mode. */
  variant?: VixlThemeVariantKind
  /** Draft theme to preview instead of the active theme. */
  theme?: VixlThemeDefinition
}

/** Fully resolved appearance after combining defaults, selection, and preview. */
export type EffectiveAppearance = {
  themeId: string
  themeName: string
  /**
   * True when the effective theme is a bundled built-in: immutable, never
   * stored in the personal library, and not editable or deletable.
   */
  readOnlyBuiltIn: boolean
  /**
   * True when the theme's palette exactly matches the hard-coded CSS cascade
   * defaults, so the runtime clears its variables instead of writing them.
   * Only the original Vixl Default theme uses CSS defaults; other read-only
   * built-ins still receive their own runtime variables.
   */
  usesCssDefaults: boolean
  colorMode: VixlColorMode
  variant: VixlThemeVariantKind
  colors: VixlThemeSemanticTokens
  canvas: VixlThemeCanvas
  glass: VixlThemeGlass
  icons: VixlThemeIconAppearance
  typography: VixlThemeTypography
  editor: VixlThemeEditorPalette
}

export type ResolveAppearanceInput = {
  colorMode: VixlColorMode
  /** Whether the OS prefers dark; used when `colorMode` is `system`. */
  systemDark?: boolean
  /** Active saved theme, or null/undefined for the built-in default. */
  theme?: VixlThemeDefinition | null
  /** Optional live preview draft; wins over the selected theme and mode. */
  preview?: AppearancePreviewDraft | null
}

/**
 * Normalized appearance-change signal for non-CSS consumers (the Monaco and
 * Shiki theme adapters). Dispatched on `window` after the runtime applies a
 * (possibly identical) appearance; `revision` disambiguates repeats.
 */
export const VIXL_APPEARANCE_CHANGE_EVENT = 'vixl:appearance-change'

/** Detail payload of the normalized `vixl:appearance-change` window event. */
export type AppearanceChangeEventDetail = {
  themeId: string
  themeName: string
  readOnlyBuiltIn: boolean
  usesCssDefaults: boolean
  colorMode: VixlColorMode
  variant: VixlThemeVariantKind
  /** Monotonic counter bumped on every applied runtime change. */
  revision: number
  previewing: boolean
  typography: VixlThemeTypography
  editor: VixlThemeEditorPalette
}

export const resolveAppearanceVariant = (
  colorMode: VixlColorMode,
  systemDark: boolean,
  previewVariant?: VixlThemeVariantKind,
): VixlThemeVariantKind => {
  if (previewVariant) {
    return previewVariant
  }
  if (colorMode === 'system') {
    return systemDark ? 'dark' : 'light'
  }
  return colorMode
}

/**
 * Resolve the effective appearance. Malformed or missing saved themes fall
 * back to the built-in default; a preview draft wins over the selection.
 * Built-in metadata (`readOnlyBuiltIn` / `usesCssDefaults`) comes from the
 * reserved built-in registry so every bundled id is classified consistently.
 */
export const resolveEffectiveAppearance = (input: ResolveAppearanceInput): EffectiveAppearance => {
  const previewTheme = input.preview?.theme ?? null
  const theme: VixlThemeDefinition =
    previewTheme ?? (input.theme?.variants ? input.theme : null) ?? builtInVixlTheme
  const variantKind = resolveAppearanceVariant(
    input.colorMode,
    input.systemDark ?? false,
    input.preview?.variant,
  )
  const variant = theme.variants?.[variantKind] ?? builtInVixlTheme.variants[variantKind]
  const meta = getBuiltinThemeMeta(theme.id)

  return {
    themeId: theme.id,
    themeName: theme.name,
    readOnlyBuiltIn: previewTheme === null ? meta !== null : false,
    usesCssDefaults: previewTheme === null && (meta?.usesCssDefaults ?? false),
    colorMode: input.colorMode,
    variant: variantKind,
    colors: variant.colors,
    canvas: variant.canvas,
    glass: variant.glass,
    icons: variant.icons,
    typography: variant.typography,
    editor: variant.editor,
  }
}

/** Stable signature used by the runtime to skip redundant re-application. */
export const getEffectiveAppearanceSignature = (
  appearance: EffectiveAppearance,
  extra: { previewing: boolean },
): string =>
  JSON.stringify({
    themeId: appearance.themeId,
    variant: appearance.variant,
    colorMode: appearance.colorMode,
    readOnlyBuiltIn: appearance.readOnlyBuiltIn,
    usesCssDefaults: appearance.usesCssDefaults,
    colors: appearance.colors,
    canvas: appearance.canvas,
    glass: appearance.glass,
    icons: appearance.icons,
    typography: appearance.typography,
    editor: appearance.editor,
    previewing: extra.previewing,
  })
