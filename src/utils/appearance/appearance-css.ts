import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import type {
  VixlThemeCanvas,
  VixlThemeCanvasLayer,
  VixlThemeGlass,
  VixlThemeGlassScope,
  VixlThemeSemanticTokens,
  VixlThemeTypography,
} from '@/types/appearance/theme'
import type { EffectiveAppearance } from '@/utils/appearance/resolve-effective-appearance'

/**
 * Runtime CSS application for the effective appearance.
 *
 * Only an allowlist of variables is ever written to
 * `document.documentElement`: the semantic shadcn/Tailwind tokens, the canvas
 * variables, the glass variables, and the typography variables. Everything
 * else in the cascade is untouched, so cards, popovers, sidebars, inputs, and
 * readable workbench surfaces keep using their semantic surface tokens.
 *
 * Values are always derived from the bounded, data-only domain (hex colors,
 * numbers, and named presets) — never raw CSS strings from theme files.
 */

/** Runtime variables for the app canvas (solid fallback + layered image). */
export const CANVAS_BACKGROUND_VARIABLE = '--vixl-canvas-background'
export const CANVAS_IMAGE_VARIABLE = '--vixl-canvas-image'

/** Runtime variables for opt-in glass surfaces (scoped via CSS utilities). */
export const GLASS_SURFACE_OPACITY_VARIABLE = '--vixl-glass-surface-opacity'
export const GLASS_BLUR_VARIABLE = '--vixl-glass-blur'
export const GLASS_SATURATION_VARIABLE = '--vixl-glass-saturation'
export const GLASS_BORDER_OPACITY_VARIABLE = '--vixl-glass-border-opacity'
export const GLASS_SHADOW_VARIABLE = '--vixl-glass-shadow'
export const GLASS_RADIUS_VARIABLE = '--vixl-glass-radius'

/** Runtime typography variables routed through the Tailwind font utilities. */
export const FONT_UI_VARIABLE = '--vixl-font-ui'
export const FONT_MONO_VARIABLE = '--vixl-font-mono'
export const FONT_SIZE_UI_VARIABLE = '--vixl-font-size-ui'

/** Appearance data attributes set on the document element. */
export const APPEARANCE_THEME_ATTRIBUTE = 'data-vixl-appearance-theme'
export const APPEARANCE_MODE_ATTRIBUTE = 'data-vixl-appearance-mode'
export const APPEARANCE_REVISION_ATTRIBUTE = 'data-vixl-appearance-revision'
export const APPEARANCE_PREVIEW_ATTRIBUTE = 'data-vixl-appearance-preview'
export const APPEARANCE_GLASS_ATTRIBUTE = 'data-vixl-appearance-glass'

/** camelCase domain token key -> kebab-case CSS variable suffix. */
export const semanticTokenVariableName = (key: keyof VixlThemeSemanticTokens): string =>
  `--${key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Za-z])(\d)/g, '$1-$2')
    .toLowerCase()}`

export const SEMANTIC_TOKEN_VARIABLE_NAMES: readonly string[] = Object.keys(
  builtInVixlTheme.variants.light.colors,
).map((key) => semanticTokenVariableName(key as keyof VixlThemeSemanticTokens))

/** Bounded CSS values for the named glass shadow presets. */
export const GLASS_SHADOW_PRESET_VALUES: Record<VixlThemeGlass['shadow'], string> = {
  none: 'none',
  subtle: '0 2px 8px rgb(0 0 0 / 0.08)',
  medium: '0 4px 16px rgb(0 0 0 / 0.14)',
  strong: '0 8px 32px rgb(0 0 0 / 0.22)',
}

/** Bounded CSS values for the named glass corner-radius presets. */
export const GLASS_RADIUS_PRESET_VALUES: Record<VixlThemeGlass['radius'], string> = {
  none: '0px',
  sm: '0.375rem',
  md: '0.75rem',
  lg: '1rem',
}

export const GLASS_VARIABLE_NAMES: readonly string[] = [
  GLASS_SURFACE_OPACITY_VARIABLE,
  GLASS_BLUR_VARIABLE,
  GLASS_SATURATION_VARIABLE,
  GLASS_BORDER_OPACITY_VARIABLE,
  GLASS_SHADOW_VARIABLE,
  GLASS_RADIUS_VARIABLE,
]

/** Every variable the runtime may write or clear. */
export const APPEARANCE_VARIABLE_NAMES: readonly string[] = [
  ...SEMANTIC_TOKEN_VARIABLE_NAMES,
  CANVAS_BACKGROUND_VARIABLE,
  CANVAS_IMAGE_VARIABLE,
  ...GLASS_VARIABLE_NAMES,
  FONT_UI_VARIABLE,
  FONT_MONO_VARIABLE,
  FONT_SIZE_UI_VARIABLE,
]

export type ApplyAppearanceOptions = {
  revision: number
  previewing: boolean
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value))
const clampAngle = (value: number): number => Math.min(360, Math.max(0, value))
const clampBlur = (value: number): number => Math.min(48, Math.max(0, value))
const clampSaturation = (value: number): number => Math.min(200, Math.max(100, value))

const renderedStops = (stops: VixlThemeCanvasLayer['stops']): string =>
  [...stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => `${stop.color} ${clampPercent(stop.position)}%`)
    .join(', ')

/** Render one structured canvas layer into a CSS gradient function value. */
export const buildCanvasLayerCss = (layer: VixlThemeCanvasLayer): string | null => {
  if (layer.stops.length < 2) {
    return null
  }
  const stops = renderedStops(layer.stops)
  if (layer.kind === 'linear') {
    return `linear-gradient(${clampAngle(layer.angle)}deg, ${stops})`
  }
  if (layer.kind === 'radial') {
    return `radial-gradient(${layer.size} at ${clampPercent(layer.x)}% ${clampPercent(layer.y)}%, ${stops})`
  }
  return `conic-gradient(from ${clampAngle(layer.angle)}deg at ${clampPercent(layer.x)}% ${clampPercent(layer.y)}%, ${stops})`
}

/**
 * Resolve the canvas CSS values. Layers render in order (earlier layers paint
 * above later ones, matching CSS multi-layer `background-image` semantics)
 * over the explicit solid fallback, so unsupported surfaces never paint
 * transparently.
 */
export const buildCanvasCss = (canvas: VixlThemeCanvas): { color: string; image: string } => {
  const images = canvas.layers
    .map(buildCanvasLayerCss)
    .filter((image): image is string => image !== null)
  return { color: canvas.fallback, image: images.length > 0 ? images.join(', ') : 'none' }
}

/**
 * Bounded glass variable values derived from the data-only glass config.
 * Returns null when glass is disabled so callers can remove the variables.
 */
export const buildGlassVariables = (glass: VixlThemeGlass): Record<string, string> | null => {
  if (!glass.enabled) {
    return null
  }
  return {
    [GLASS_SURFACE_OPACITY_VARIABLE]: `${clampPercent(glass.surfaceOpacity)}%`,
    [GLASS_BLUR_VARIABLE]: `${clampBlur(glass.blur)}px`,
    [GLASS_SATURATION_VARIABLE]: `${clampSaturation(glass.saturation)}%`,
    [GLASS_BORDER_OPACITY_VARIABLE]: `${clampPercent(glass.borderOpacity)}%`,
    [GLASS_SHADOW_VARIABLE]: GLASS_SHADOW_PRESET_VALUES[glass.shadow],
    [GLASS_RADIUS_VARIABLE]: GLASS_RADIUS_PRESET_VALUES[glass.radius],
  }
}

/** Space-separated glass scopes for the runtime data attribute. */
export const glassScopesAttribute = (glass: VixlThemeGlass): string | null => {
  if (!glass.enabled) {
    return null
  }
  const scopes = glass.scopes.filter(
    (scope: VixlThemeGlassScope, index: number) => glass.scopes.indexOf(scope) === index,
  )
  return scopes.length > 0 ? scopes.join(' ') : null
}

/** Quote a font family for CSS; bare identifiers stay unquoted. */
const cssFontFamily = (family: string): string => {
  const trimmed = family.trim()
  if (trimmed.length === 0) {
    return ''
  }
  if (/^-?[A-Za-z][A-Za-z0-9-]*$/.test(trimmed)) {
    return trimmed
  }
  return `"${trimmed.replace(/"/g, '\\"')}"`
}

/** Full font-family value: primary family plus explicit fallback stack. */
export const buildFontFamilyCss = (
  typography: Pick<VixlThemeTypography, 'uiFontFamily' | 'uiFontFallbacks'>,
): string =>
  [cssFontFamily(typography.uiFontFamily), ...typography.uiFontFallbacks.map(cssFontFamily)]
    .filter((family) => family.length > 0)
    .join(', ')

const setSemanticTokenVariables = (root: HTMLElement, colors: VixlThemeSemanticTokens): void => {
  for (const key of Object.keys(colors) as Array<keyof VixlThemeSemanticTokens>) {
    root.style.setProperty(semanticTokenVariableName(key), colors[key])
  }
}

const setGlassVariables = (root: HTMLElement, glass: VixlThemeGlass): void => {
  const variables = buildGlassVariables(glass)
  if (variables === null) {
    for (const variable of GLASS_VARIABLE_NAMES) {
      root.style.removeProperty(variable)
    }
    root.removeAttribute(APPEARANCE_GLASS_ATTRIBUTE)
    return
  }
  for (const [variable, value] of Object.entries(variables)) {
    root.style.setProperty(variable, value)
  }
  const scopes = glassScopesAttribute(glass)
  if (scopes !== null) {
    root.setAttribute(APPEARANCE_GLASS_ATTRIBUTE, scopes)
  } else {
    root.removeAttribute(APPEARANCE_GLASS_ATTRIBUTE)
  }
}

const setAppearanceAttributes = (
  root: HTMLElement,
  appearance: EffectiveAppearance,
  options: ApplyAppearanceOptions,
): void => {
  root.setAttribute(APPEARANCE_THEME_ATTRIBUTE, appearance.themeId)
  root.setAttribute(APPEARANCE_MODE_ATTRIBUTE, appearance.variant)
  root.setAttribute(APPEARANCE_REVISION_ATTRIBUTE, String(options.revision))
  if (options.previewing) {
    root.setAttribute(APPEARANCE_PREVIEW_ATTRIBUTE, 'true')
  } else {
    root.removeAttribute(APPEARANCE_PREVIEW_ATTRIBUTE)
  }
}

/**
 * Apply the effective appearance: semantic token variables, typography
 * variables, layered canvas background, glass variables, and the appearance
 * data attributes.
 *
 * When the CSS-default built-in theme is active (and not previewing), every
 * runtime-owned variable is cleared instead so the CSS-cascade defaults —
 * which match the shipped palette exactly — remain authoritative and no stale
 * custom values survive. Other read-only built-in themes still receive their
 * own runtime variables; they are immutable but visible. Data attributes are
 * still maintained in both cases.
 */
export const applyEffectiveAppearance = (
  root: HTMLElement,
  appearance: EffectiveAppearance,
  options: ApplyAppearanceOptions,
): void => {
  if (appearance.usesCssDefaults && !options.previewing) {
    clearAppearanceVariables(root)
    root.removeAttribute(APPEARANCE_GLASS_ATTRIBUTE)
  } else {
    setSemanticTokenVariables(root, appearance.colors)

    const canvas = buildCanvasCss(appearance.canvas)
    root.style.setProperty(CANVAS_BACKGROUND_VARIABLE, canvas.color)
    root.style.setProperty(CANVAS_IMAGE_VARIABLE, canvas.image)

    setGlassVariables(root, appearance.glass)

    root.style.setProperty(FONT_UI_VARIABLE, buildFontFamilyCss(appearance.typography))
    root.style.setProperty(
      FONT_MONO_VARIABLE,
      buildFontFamilyCss({
        uiFontFamily: appearance.typography.monoFontFamily,
        uiFontFallbacks: appearance.typography.monoFontFallbacks,
      }),
    )
    root.style.setProperty(FONT_SIZE_UI_VARIABLE, `${appearance.typography.uiFontSize}px`)
  }

  setAppearanceAttributes(root, appearance, options)
}

/**
 * Clear every runtime-owned variable. Used when returning to the CSS-default
 * built-in theme so the CSS-cascade defaults (which match the shipped palette
 * exactly) remain authoritative and no stale custom values survive.
 */
export const clearAppearanceVariables = (root: HTMLElement): void => {
  for (const variable of APPEARANCE_VARIABLE_NAMES) {
    root.style.removeProperty(variable)
  }
}

/** Remove the appearance data attributes (runtime teardown). */
export const clearAppearanceAttributes = (root: HTMLElement): void => {
  root.removeAttribute(APPEARANCE_THEME_ATTRIBUTE)
  root.removeAttribute(APPEARANCE_MODE_ATTRIBUTE)
  root.removeAttribute(APPEARANCE_REVISION_ATTRIBUTE)
  root.removeAttribute(APPEARANCE_PREVIEW_ATTRIBUTE)
  root.removeAttribute(APPEARANCE_GLASS_ATTRIBUTE)
}
