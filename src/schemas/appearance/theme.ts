import { z } from 'zod'
import {
  THEME_GLASS_RADIUS_PRESETS,
  THEME_GLASS_SCOPES,
  THEME_GLASS_SHADOW_PRESETS,
  THEME_ICON_PACKS,
  THEME_RADIAL_SIZES,
  VIXL_THEME_FORMAT_VERSION,
} from '@/types/appearance/theme'
import { isReservedThemeId } from '@/constants/appearance/built-in-theme-registry'

/**
 * Strict schemas for the runtime theme domain.
 *
 * The v2 schema (canonical) is strict and bounded: it rejects unknown fields,
 * unsupported versions, malformed identifiers, colors outside the safe hex
 * forms, unsafe font values, out-of-range sizes, angles, gradient stops,
 * layer counts, glass values, and icon settings. No raw CSS, URLs, SVG, image
 * data, or font sources. The dedicated v1 schema lives in `./theme-v1`.
 */

export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/

export const THEME_NAME_MAX_LENGTH = 64
export const THEME_FONT_FAMILY_MAX_LENGTH = 200
export const THEME_FONT_FALLBACK_MAX_COUNT = 8
export const THEME_FONT_SIZE_MIN = 8
export const THEME_FONT_SIZE_MAX = 32
export const THEME_GRADIENT_ANGLE_MAX = 360

/** v1 single-gradient bounds (retained for the v1 schema). */
export const THEME_GRADIENT_STOP_MIN = 2
export const THEME_GRADIENT_STOP_MAX = 5

/** v2 per-layer bounds: up to four layers of 2-6 stops each. */
export const THEME_CANVAS_LAYER_STOP_MIN = 2
export const THEME_CANVAS_LAYER_STOP_MAX = 6
export const THEME_CANVAS_MAX_LAYERS = 4
export const THEME_GRADIENT_POSITION_MAX = 100

/** Bounded glass values (percent-based, plus a bounded px blur). */
export const THEME_GLASS_SURFACE_OPACITY_MAX = 100
export const THEME_GLASS_BLUR_MAX = 48
export const THEME_GLASS_SATURATION_MIN = 100
export const THEME_GLASS_SATURATION_MAX = 200
export const THEME_GLASS_BORDER_OPACITY_MAX = 100

/** Bounded icon appearance values. */
export const THEME_ICON_WEIGHT_MIN = 1
export const THEME_ICON_WEIGHT_MAX = 2.5
export const THEME_ICON_SIZE_SCALE_MIN = 0.75
export const THEME_ICON_SIZE_SCALE_MAX = 1.5

/**
 * Authoritative library cap. The personal theme library (`appearance.themeLibrary`)
 * never holds more themes than this, whether they were created in the editor or
 * imported from shareable files. The shareable file schema in
 * `@/schemas/appearance/theme-file` reuses these limits so imports and exports
 * accept exactly the values the runtime domain model accepts.
 */
export const THEME_LIBRARY_MAX_SIZE = 50

/** Safe hex color forms only: #RGB, #RGBA, #RRGGBB, #RRGGBBAA. */
export const THEME_HEX_COLOR_PATTERN =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * Font family names are data, not CSS: block characters that would allow
 * CSS injection (`;`, `{`, `}`, parentheses, slashes, colons, etc.).
 */
export const THEME_FONT_FAMILY_PATTERN = /^[A-Za-z0-9 _'"+.,-]+$/

export const hexColorSchema = z
  .string()
  .regex(THEME_HEX_COLOR_PATTERN, 'must be a hex color (#RGB, #RGBA, #RRGGBB, or #RRGGBBAA)')

/** True for multiples of 0.5 / 0.01 (tolerating float representation error). */
const isHalfStep = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9
const isCentiStep = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-9

const fontFamilySchema = z
  .string()
  .min(1)
  .max(THEME_FONT_FAMILY_MAX_LENGTH)
  .regex(THEME_FONT_FAMILY_PATTERN, 'contains characters not allowed in font family names')

const fontSizeSchema = z
  .number()
  .min(THEME_FONT_SIZE_MIN)
  .max(THEME_FONT_SIZE_MAX)
  .refine((value) => Number.isFinite(value) && (value * 2) % 1 === 0, {
    message: `must be a multiple of 0.5 between ${THEME_FONT_SIZE_MIN} and ${THEME_FONT_SIZE_MAX}`,
  })

export const themeFontSizeSchema = fontSizeSchema

/** Shared gradient-stop shape (safe hex plus bounded position). */
export const gradientStopSchema = z
  .object({
    color: hexColorSchema,
    position: z.number().min(0).max(THEME_GRADIENT_POSITION_MAX),
  })
  .strict()

export const sortedStopsRefine = <T extends { position: number }>(stops: T[]): boolean =>
  stops.every((stop, index) => index === 0 || stop.position >= (stops[index - 1]?.position ?? 0))

/** ------------------------------------------------------------------ v2 --- */

const canvasLayerStopSchema = z
  .array(gradientStopSchema)
  .min(THEME_CANVAS_LAYER_STOP_MIN)
  .max(THEME_CANVAS_LAYER_STOP_MAX)
  .refine(sortedStopsRefine, {
    message: 'gradient stops must be sorted by ascending position',
  })

const percentSchema = z.number().min(0).max(THEME_GRADIENT_POSITION_MAX)
const angleSchema = z.number().min(0).max(THEME_GRADIENT_ANGLE_MAX)

export const themeCanvasLayerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('linear'),
      angle: angleSchema,
      stops: canvasLayerStopSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('radial'),
      x: percentSchema,
      y: percentSchema,
      size: z.enum(THEME_RADIAL_SIZES),
      stops: canvasLayerStopSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('conic'),
      angle: angleSchema,
      x: percentSchema,
      y: percentSchema,
      stops: canvasLayerStopSchema,
    })
    .strict(),
])

export type ThemeCanvasLayerParsed = z.infer<typeof themeCanvasLayerSchema>

/** v2 canvas: explicit solid fallback plus 0-4 ordered layers. */
export const themeCanvasSchema = z
  .object({
    fallback: hexColorSchema,
    layers: z.array(themeCanvasLayerSchema).max(THEME_CANVAS_MAX_LAYERS),
  })
  .strict()

export type ThemeCanvasParsed = z.infer<typeof themeCanvasSchema>

export const themeGlassSchema = z
  .object({
    enabled: z.boolean(),
    scopes: z.array(z.enum(THEME_GLASS_SCOPES)),
    surfaceOpacity: z.number().min(0).max(THEME_GLASS_SURFACE_OPACITY_MAX),
    blur: z.number().min(0).max(THEME_GLASS_BLUR_MAX),
    saturation: z.number().min(THEME_GLASS_SATURATION_MIN).max(THEME_GLASS_SATURATION_MAX),
    borderOpacity: z.number().min(0).max(THEME_GLASS_BORDER_OPACITY_MAX),
    shadow: z.enum(THEME_GLASS_SHADOW_PRESETS),
    radius: z.enum(THEME_GLASS_RADIUS_PRESETS),
  })
  .strict()

export type ThemeGlassParsed = z.infer<typeof themeGlassSchema>

export const themeIconAppearanceSchema = z
  .object({
    pack: z.enum(THEME_ICON_PACKS),
    weight: z
      .number()
      .min(THEME_ICON_WEIGHT_MIN)
      .max(THEME_ICON_WEIGHT_MAX)
      .refine(isHalfStep, { message: 'weight must be a multiple of 0.5' }),
    sizeScale: z
      .number()
      .min(THEME_ICON_SIZE_SCALE_MIN)
      .max(THEME_ICON_SIZE_SCALE_MAX)
      .refine(isCentiStep, { message: 'sizeScale must be a multiple of 0.01' }),
    tint: z.union([z.literal('inherit'), hexColorSchema]),
  })
  .strict()

export type ThemeIconAppearanceParsed = z.infer<typeof themeIconAppearanceSchema>

export const typographySchema = z
  .object({
    uiFontFamily: fontFamilySchema,
    uiFontFallbacks: z.array(fontFamilySchema).max(THEME_FONT_FALLBACK_MAX_COUNT),
    monoFontFamily: fontFamilySchema,
    monoFontFallbacks: z.array(fontFamilySchema).max(THEME_FONT_FALLBACK_MAX_COUNT),
    uiFontSize: fontSizeSchema,
    editorFontSize: fontSizeSchema,
  })
  .strict()

/** Monaco/Shiki editor palette keys (see `VixlSyntaxPalette`). */
const THEME_EDITOR_PALETTE_KEYS = [
  'background',
  'foreground',
  'comment',
  'keyword',
  'keywordAccent',
  'string',
  'number',
  'function',
  'type',
  'variable',
  'constant',
  'operator',
  'invalid',
  'regexp',
  'attribute',
  'tag',
  'escape',
  'hoverWidgetBackground',
  'hoverWidgetForeground',
  'hoverWidgetBorder',
  'suggestWidgetBackground',
  'suggestWidgetForeground',
  'suggestWidgetBorder',
] as const

const editorPaletteEntries = Object.fromEntries(
  THEME_EDITOR_PALETTE_KEYS.map((key) => [key, hexColorSchema]),
) as Record<(typeof THEME_EDITOR_PALETTE_KEYS)[number], typeof hexColorSchema>

export const editorPaletteSchema = z.object(editorPaletteEntries).strict()

/** Semantic shadcn-style tokens required for every variant. */
const THEME_SEMANTIC_TOKEN_KEYS = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'border',
  'input',
  'ring',
  'sidebar',
  'sidebarForeground',
  'sidebarPrimary',
  'sidebarPrimaryForeground',
  'sidebarAccent',
  'sidebarAccentForeground',
  'sidebarBorder',
  'sidebarRing',
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
] as const

const semanticTokenEntries = Object.fromEntries(
  THEME_SEMANTIC_TOKEN_KEYS.map((key) => [key, hexColorSchema]),
) as Record<(typeof THEME_SEMANTIC_TOKEN_KEYS)[number], typeof hexColorSchema>

export const semanticTokensSchema = z.object(semanticTokenEntries).strict()

export const themeIdRefinement = z
  .string()
  .regex(THEME_ID_PATTERN, 'must be 2-64 chars of a-z, 0-9, and hyphens, starting alphanumeric')
  .refine((id) => !isReservedThemeId(id), {
    message: 'this id is reserved for a bundled built-in theme',
  })

const themeVariantSchema = z
  .object({
    colors: semanticTokensSchema,
    canvas: themeCanvasSchema,
    glass: themeGlassSchema,
    icons: themeIconAppearanceSchema,
    typography: typographySchema,
    editor: editorPaletteSchema,
  })
  .strict()

/** Variant shape (exported for bundled-theme registry invariant checks). */
export { themeVariantSchema }

/**
 * Runtime domain schema (v2) for a theme stored in the personal settings
 * library (`appearance.themeLibrary`). The versioned shareable file format
 * lives in `@/schemas/appearance/theme-file`; imported file payloads are
 * converted to this domain shape by `themeFilePayloadToThemeDefinition`.
 */
export const themeDefinitionSchema = z
  .object({
    id: themeIdRefinement,
    name: z.string().min(1).max(THEME_NAME_MAX_LENGTH),
    version: z.literal(VIXL_THEME_FORMAT_VERSION),
    variants: z
      .object({
        light: themeVariantSchema,
        dark: themeVariantSchema,
      })
      .strict(),
  })
  .strict()

export type ThemeDefinitionParsed = z.infer<typeof themeDefinitionSchema>

/**
 * Shared font-size rule for both the runtime domain model and the shareable
 * file format (see `@/schemas/appearance/theme-file`).
 */
export const formatThemeSchemaError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'theme'
      return `${path}: ${issue.message}`
    })
    .join('; ')

export const parseThemeDefinition = (
  raw: unknown,
): { success: true; data: ThemeDefinitionParsed } | { success: false; error: string } => {
  const parsed = themeDefinitionSchema.safeParse(raw)
  if (!parsed.success) {
    return { success: false, error: formatThemeSchemaError(parsed.error) }
  }
  return { success: true, data: parsed.data }
}
