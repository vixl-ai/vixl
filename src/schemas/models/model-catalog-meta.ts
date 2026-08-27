import { z } from 'zod'
import modelPricingRatesSchema from '@/schemas/billing/model-pricing-rates-schema'

export const modelCatalogMetaSchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  pricing: modelPricingRatesSchema.optional(),
  vision: z.boolean().optional(),
  toolCalling: z.boolean().optional(),
})

export const modelCatalogMetaMapSchema = z.record(
  z.string().min(1),
  modelCatalogMetaSchema,
)

export default modelCatalogMetaSchema
