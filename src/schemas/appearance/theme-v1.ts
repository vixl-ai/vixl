import { z } from 'zod'
import {
  THEME_GRADIENT_ANGLE_MAX,
  THEME_GRADIENT_STOP_MAX,
  THEME_GRADIENT_STOP_MIN,
  THEME_NAME_MAX_LENGTH,
  editorPaletteSchema,
  gradientStopSchema,
  hexColorSchema,
  semanticTokensSchema,
  sortedStopsRefine,
  themeIdRefinement,
  typographySchema,
} from './theme'

/**
 * Strict version-1 runtime domain schema.
 *
 * Retained only so persisted v1 library entries can be migrated to v2 (see
 * `@/services/appearance/theme-migration`). It is never used to validate new
 * themes: the canonical v2 domain schema lives in `./theme`.
 */

const canvasBackgroundV1Schema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('solid'),
      color: hexColorSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('gradient'),
      angle: z.number().min(0).max(THEME_GRADIENT_ANGLE_MAX),
      stops: z
        .array(gradientStopSchema)
        .min(THEME_GRADIENT_STOP_MIN)
        .max(THEME_GRADIENT_STOP_MAX)
        .refine(sortedStopsRefine, {
          message: 'gradient stops must be sorted by ascending position',
        }),
      fallback: hexColorSchema.optional(),
    })
    .strict(),
])

const themeVariantV1Schema = z
  .object({
    colors: semanticTokensSchema,
    canvas: canvasBackgroundV1Schema,
    typography: typographySchema,
    editor: editorPaletteSchema,
  })
  .strict()

/**
 * Strict v1 domain schema for a theme stored in the personal settings
 * library before format version 2.
 */
export const themeDefinitionV1Schema = z
  .object({
    id: themeIdRefinement,
    name: z.string().min(1).max(THEME_NAME_MAX_LENGTH),
    version: z.literal(1),
    variants: z
      .object({
        light: themeVariantV1Schema,
        dark: themeVariantV1Schema,
      })
      .strict(),
  })
  .strict()

export type ThemeDefinitionV1Parsed = z.infer<typeof themeDefinitionV1Schema>
