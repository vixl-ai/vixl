import { z } from 'zod'

export const planTodoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
})

export const planTodoItemPatchSchema = planTodoItemSchema.partial().required({
  id: true,
})

export const planFrontmatterSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string().datetime(),
  mode: z.literal('plan'),
  sourceChatId: z.string().optional(),
  sourceChatSlug: z.string().optional(),
  parent: z.string().optional(),
  builtAt: z.string().datetime().optional(),
  lastBuildChatId: z.string().optional(),
  lastBuildChatSlug: z.string().optional(),
  lastBuildModel: z.string().optional(),
  todos: z.array(planTodoItemSchema),
})

export const parsedPlanSchema = z.object({
  frontmatter: planFrontmatterSchema,
  body: z.string(),
})

export const formatPlanSchemaError = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
