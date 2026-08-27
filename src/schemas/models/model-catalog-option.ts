import { z } from 'zod'
import { reasoningLevelSchema } from '@/schemas/models/reasoning-level'

export const modelCatalogOptionSchema = z.object({
  reasoning: reasoningLevelSchema.optional(),
  fast: z.boolean().optional(),
  allowed: z.boolean().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
})

export const modelCatalogOptionsMapSchema = z.record(
  z.string().min(1),
  modelCatalogOptionSchema,
)

export default modelCatalogOptionSchema
