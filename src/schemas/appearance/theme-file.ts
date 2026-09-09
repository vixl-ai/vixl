import { z } from 'zod'
import {
  THEME_CANVAS_MAX_LAYERS,
  THEME_FONT_FAMILY_MAX_LENGTH,
  THEME_FONT_FAMILY_PATTERN,
  THEME_GRADIENT_ANGLE_MAX,
  THEME_GRADIENT_POSITION_MAX,
  THEME_GRADIENT_STOP_MAX,
  THEME_GRADIENT_STOP_MIN,
  THEME_HEX_COLOR_PATTERN,
  themeCanvasLayerSchema,
  themeFontSizeSchema,
  themeGlassSchema as themeGlassSchemaImport,
  themeIconAppearanceSchema as themeIconAppearanceSchemaImport,
} from './theme'
import {
  THEME_GLASS_RADIUS_PRESETS,
  THEME_GLASS_SCOPES,
  THEME_GLASS_SHADOW_PRESETS,
  THEME_ICON_PACKS,
  THEME_RADIAL_SIZES,
} from '@/types/appearance/theme'

/**
 * Strict schemas for shareable `.vixl-theme.json` files.
 *
 * This is intentionally separate from the runtime theme domain model: it is
 * the versioned on-disk exchange format. The canonical format is version 2
 * (layered canvas backgrounds, glass, icons). The dedicated version-1 schema
 * is retained strictly so imported v1 files can be migrated to v2 instead of
 * rejected; see `@/services/appearance/theme-migration`.
 *
 * Unknown fields, raw CSS, URLs, font sources, and image data are rejected so
 * imported themes stay data-only. Value limits (hex forms, font-family rules,
 * font sizes, gradient/layer bounds, glass bounds, icon bounds, library cap)
 * are the authoritative limits from `./theme` so a theme created in the
 * Appearance editor can always be exported, and every imported file is
 * exactly as strict as the runtime domain schema.
 */

export const THEME_FILE_FORMAT = 'vixl-theme' as const
export const THEME_FILE_VERSION = 2
export const THEME_FILE_EXTENSION = '.vixl-theme.json'
export const THEME_FILE_MAX_BYTES = 1024 * 1024

export const THEME_FILE_NAME_MAX_LENGTH = 64
export const THEME_ID_MAX_LENGTH = 64

/** Safe hex forms: #RGB, #RGBA, #RRGGBB, #RRGGBBAA (shared with the domain schema). */
export const hexColorSchema = z
  .string()
  .regex(THEME_HEX_COLOR_PATTERN, 'Expected a hex color like #1a2b3c')

export const themeIdSchema = z
  .string()
  .max(THEME_ID_MAX_LENGTH)
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Expected a lowercase slug id like sunset-theme')

const hasControlCharOrAngleBracket = (value: string): boolean => {
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint <= 0x001f || codePoint === 0x007f || char === '<' || char === '>') {
      return true
    }
  }
  return false
}

export const themeNameSchema = z
  .string()
  .trim()
  .min(1, 'Theme name is required')
  .max(
    THEME_FILE_NAME_MAX_LENGTH,
    `Theme name must be at most ${THEME_FILE_NAME_MAX_LENGTH} characters`,
  )
  .refine(
    (name) => !hasControlCharOrAngleBracket(name),
    'Theme name must not contain control characters or angle brackets',
  )

/**
 * Font families are display-name lists only. Quotes, braces, semicolons,
 * `url(`, `var(`, and other CSS escape hatches are rejected.
 */
export const fontFamilySchema = z
  .string()
  .trim()
  .min(1, 'Font family is required')
  .max(
    THEME_FONT_FAMILY_MAX_LENGTH,
    `Font family must be at most ${THEME_FONT_FAMILY_MAX_LENGTH} characters`,
  )
  .refine(
    (family) => THEME_FONT_FAMILY_PATTERN.test(family),
    'Font family may only contain letters, digits, spaces, and a small punctuation set',
  )

// Shared bounded font-size rule (8-32, half-point steps) so the Appearance
// editor's clamped values always round-trip through the file format.
export const uiFontSizeSchema = themeFontSizeSchema
export const editorFontSizeSchema = themeFontSizeSchema

export const gradientStopSchema = z
  .object({
    color: hexColorSchema,
    position: z.number().min(0).max(THEME_GRADIENT_POSITION_MAX),
  })
  .strict()

export const themeBackgroundSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('solid'),
      color: hexColorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('gradient'),
      // The runtime canvas treats the fallback as optional; keep both sides
      // identical so editor-created gradients export unchanged.
      fallback: hexColorSchema.optional(),
      angle: z.number().min(0).max(THEME_GRADIENT_ANGLE_MAX),
      stops: z
        .array(gradientStopSchema)
        .min(THEME_GRADIENT_STOP_MIN, `Gradient needs at least ${THEME_GRADIENT_STOP_MIN} stops`)
        .max(THEME_GRADIENT_STOP_MAX, `Gradient supports at most ${THEME_GRADIENT_STOP_MAX} stops`)
        .refine(
          (stops) =>
            stops.every(
              (stop, index) => index === 0 || stop.position >= (stops[index - 1]?.position ?? 0),
            ),
          'Gradient stops must be sorted by ascending position',
        ),
    })
    .strict(),
])

/**
 * v2 shareable canvas: explicit solid fallback plus 0-4 ordered layers using
 * the same bounded layer schema as the runtime domain.
 */
export const themeFileBackgroundV2Schema = z
  .object({
    fallback: hexColorSchema,
    layers: z
      .array(themeCanvasLayerSchema)
      .max(THEME_CANVAS_MAX_LAYERS, `Canvas supports at most ${THEME_CANVAS_MAX_LAYERS} layers`),
  })
  .strict()

export type ThemeFileBackgroundV2 = z.infer<typeof themeFileBackgroundV2Schema>

/** Semantic shadcn-style tokens required for every variant. */
export const THEME_VARIANT_TOKEN_KEYS = [
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

export type ThemeVariantTokenKey = (typeof THEME_VARIANT_TOKEN_KEYS)[number]

const tokenEntries = Object.fromEntries(
  THEME_VARIANT_TOKEN_KEYS.map((key) => [key, hexColorSchema]),
) as Record<ThemeVariantTokenKey, typeof hexColorSchema>

export const themeTokenMapSchema = z.object(tokenEntries).strict()

export type ThemeTokenMap = z.infer<typeof themeTokenMapSchema>

/** Monaco/Shiki editor palette keys matching `VixlSyntaxPalette`. */
export const THEME_EDITOR_PALETTE_KEYS = [
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
] as const

export type ThemeEditorPaletteKey = (typeof THEME_EDITOR_PALETTE_KEYS)[number]

const editorPaletteEntries = Object.fromEntries(
  THEME_EDITOR_PALETTE_KEYS.map((key) => [key, hexColorSchema]),
) as Record<ThemeEditorPaletteKey, typeof hexColorSchema>

export const themeEditorPaletteSchema = z.object(editorPaletteEntries).strict()

export type ThemeEditorPalette = z.infer<typeof themeEditorPaletteSchema>

export const themeTypographySchema = z
  .object({
    uiFontFamily: fontFamilySchema,
    monoFontFamily: fontFamilySchema,
    uiFontSize: uiFontSizeSchema,
    editorFontSize: editorFontSizeSchema,
  })
  .strict()

export type ThemeTypography = z.infer<typeof themeTypographySchema>

// Re-export the shared bounded glass/icon schemas so file payloads are exactly
// as strict as the runtime domain model.
export {
  THEME_GLASS_RADIUS_PRESETS,
  THEME_GLASS_SCOPES,
  THEME_GLASS_SHADOW_PRESETS,
  THEME_ICON_PACKS,
  THEME_RADIAL_SIZES,
}
export const themeGlassSchema = themeGlassSchemaImport
export const themeIconAppearanceSchema = themeIconAppearanceSchemaImport
export type ThemeGlass = z.infer<typeof themeGlassSchema>
export type ThemeIconAppearance = z.infer<typeof themeIconAppearanceSchema>

const themeFileVariantV2Schema = z
  .object({
    tokens: themeTokenMapSchema,
    background: themeFileBackgroundV2Schema,
    glass: themeGlassSchema,
    icons: themeIconAppearanceSchema,
    editor: themeEditorPaletteSchema,
  })
  .strict()

export type ThemeFileVariantV2 = z.infer<typeof themeFileVariantV2Schema>

const themeFileEnvelopeV2 = {
  format: z.literal(THEME_FILE_FORMAT),
  version: z.literal(THEME_FILE_VERSION),
  id: themeIdSchema,
  name: themeNameSchema,
  typography: themeTypographySchema,
  variants: z
    .object({
      light: themeFileVariantV2Schema,
      dark: themeFileVariantV2Schema,
    })
    .strict(),
} as const

/**
 * Canonical shareable file schema (version 2): layered canvas, glass, and
 * icon appearance alongside the v1 tokens, typography, and editor palette.
 */
export const themeFilePayloadSchema = z.object(themeFileEnvelopeV2).strict()

export type ThemeFilePayload = z.infer<typeof themeFilePayloadSchema>

export type ThemeFileVariantKey = keyof ThemeFilePayload['variants']

/** ------------------------------------------------------------------ v1 --- */

const themeFileVariantV1Schema = z
  .object({
    tokens: themeTokenMapSchema,
    background: themeBackgroundSchema,
    editor: themeEditorPaletteSchema,
  })
  .strict()

export type ThemeFileVariantV1 = z.infer<typeof themeFileVariantV1Schema>

/**
 * Strict version-1 file schema, retained only so imported v1 files can be
 * migrated to v2 (see `@/services/appearance/theme-migration`). It is never
 * used for exports; the canonical export is always v2.
 */
export const themeFilePayloadV1Schema = z
  .object({
    format: z.literal(THEME_FILE_FORMAT),
    version: z.literal(1),
    id: themeIdSchema,
    name: themeNameSchema,
    typography: themeTypographySchema,
    variants: z
      .object({
        light: themeFileVariantV1Schema,
        dark: themeFileVariantV1Schema,
      })
      .strict(),
  })
  .strict()

export type ThemeFilePayloadV1 = z.infer<typeof themeFilePayloadV1Schema>

export type ThemeFileVariantKeyV1 = keyof ThemeFilePayloadV1['variants']
