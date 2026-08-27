import { z } from 'zod'

const chatModeSchema = z.enum(['ask', 'plan', 'studio', 'agent', 'orchestrator'])

const systemPromptPartsSchema = z.object({
  base: z.string(),
  tools: z.string(),
  mcp: z.string(),
  rules: z.string(),
  subagents: z.string(),
  mentions: z.string(),
  skills: z.string(),
})

export const prefixSnapshotSchema = z.object({
  systemString: z.string(),
  toolSchemasJson: z.string(),
  mcpCatalogSnapshot: z.string(),
  rulesBodies: z.string(),
  hash: z.string(),
  frozenAt: z.string(),
  mode: chatModeSchema.optional(),
  parts: systemPromptPartsSchema.optional(),
})

export const activeContextSchema = z.object({
  checkpointLineId: z.string().optional(),
  includeFromCreatedAt: z.string().optional(),
  summary: z.string().optional(),
})

export const chatAttentionSchema = z
  .enum(['needs_approval', 'needs_input', 'needs_mcp_auth', 'completed', 'error'])
  .nullable()

const awaitingPlanGoSchema = z
  .object({
    planPath: z.string(),
    planId: z.string(),
  })
  .nullable()

export const chatMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectSlug: z.string(),
  projectRoot: z.string(),
  mode: chatModeSchema,
  model: z.string(),
  status: z.enum(['idle', 'running']),
  attention: chatAttentionSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  forkedFrom: z.string().nullable(),
  pinned: z.boolean(),
  pinnedAt: z.string().nullable(),
  prefixSnapshot: prefixSnapshotSchema.optional(),
  activeContext: activeContextSchema.optional(),
  awaitingPlanGo: awaitingPlanGoSchema.optional(),
  subagentModel: z.string().nullable().optional(),
  reasoning: z.string().nullable().optional(),
  subagentReasoning: z.string().nullable().optional(),
  usageTotals: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
      costUSD: z.number().nullable(),
      pricingComplete: z.boolean(),
    })
    .optional(),
})
