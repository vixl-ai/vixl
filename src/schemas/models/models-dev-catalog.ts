import { z } from 'zod'

const modelsDevCostSchema = z
  .object({
    input: z.number().finite().optional(),
    output: z.number().finite().optional(),
    cache_read: z.number().finite().optional(),
    cache_write: z.number().finite().optional(),
    reasoning: z.number().finite().optional(),
  })
  .passthrough()

const modelsDevLimitSchema = z
  .object({
    context: z.number().finite().optional(),
    input: z.number().finite().optional(),
    output: z.number().finite().optional(),
  })
  .passthrough()

const modelsDevModalitiesSchema = z
  .object({
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
  })
  .passthrough()

const modelsDevModeSchema = z
  .object({
    cost: modelsDevCostSchema.optional().catch(undefined),
  })
  .passthrough()

const modelsDevExperimentalSchema = z
  .object({
    modes: z.record(z.string(), modelsDevModeSchema).optional(),
  })
  .passthrough()

const modelsDevModelSchema = z
  .object({
    modalities: modelsDevModalitiesSchema.optional().catch(undefined),
    cost: modelsDevCostSchema.optional().catch(undefined),
    limit: modelsDevLimitSchema.optional().catch(undefined),
    tool_call: z.boolean().optional().catch(undefined),
    reasoning: z.boolean().optional().catch(undefined),
    experimental: modelsDevExperimentalSchema.optional().catch(undefined),
  })
  .passthrough()

const modelsDevProviderSchema = z
  .object({
    api: z.string().optional().catch(undefined),
    npm: z.string().optional().catch(undefined),
    models: z.record(z.string(), modelsDevModelSchema).optional(),
  })
  .passthrough()

const modelsDevCatalogSchema = z.record(z.string(), modelsDevProviderSchema)

export type ModelsDevCost = z.infer<typeof modelsDevCostSchema>
export type ModelsDevCatalog = z.infer<typeof modelsDevCatalogSchema>
export type ModelsDevModel = z.infer<typeof modelsDevModelSchema>

export default modelsDevCatalogSchema
