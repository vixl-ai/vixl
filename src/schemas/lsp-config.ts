import { z } from 'zod'

export const lspServerEntrySchema = z.object({
  disabled: z.boolean().optional(),
  command: z.array(z.string()).optional(),
  extensions: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  initialization: z.record(z.string(), z.unknown()).optional(),
})

export const lspConfigSchema = z.union([
  z.boolean(),
  z.record(z.string(), lspServerEntrySchema),
])
