import { z } from 'zod'
import { mentionHighlightSchema } from '@/schemas/mention-highlight'

export const chatMessageLineSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.record(z.string(), z.unknown())),
  createdAt: z.string(),
  model: z.string().optional(),
  mentionHighlights: z.array(mentionHighlightSchema).optional(),
  harnessEvent: z.record(z.string(), z.unknown()).optional(),
})
