import { z } from 'zod'
import modelPricingRatesSchema from '@/schemas/billing/model-pricing-rates-schema'

export const customProviderModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  contextWindow: z.number().int().positive().optional(),
  toolCalling: z.boolean().optional(),
  vision: z.boolean().optional(),
  thinking: z.boolean().optional(),
  streaming: z.boolean().optional(),
  supportsReasoningEffort: z.array(z.string().min(1)).optional(),
  reasoningEffort: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().int().positive().optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  seed: z.number().int().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  modelOptions: z.record(z.string(), z.unknown()).optional(),
  pricing: modelPricingRatesSchema.optional(),
  fastPricing: modelPricingRatesSchema.optional(),
})

export const customProviderSchema = z.object({
  type: z.literal('openai-compatible'),
  name: z.string().min(1),
  baseURL: z.string().url(),
  apiKeyRef: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  includeUsage: z.boolean().optional(),
  supportsStructuredOutputs: z.boolean().optional(),
  models: z.array(customProviderModelSchema).optional(),
})

export type CustomProviderModel = z.infer<typeof customProviderModelSchema>
export type CustomProvider = z.infer<typeof customProviderSchema>

export const formatCustomProviderSchemaError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('; ')
