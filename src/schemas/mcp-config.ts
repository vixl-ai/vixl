import { z } from 'zod'
import type { ParseMcpConfigResult } from '@/types/vixl/mcp-config'

const stdioServerSchema = z.object({
  // Hard allowlist is enforced in Rust mcp_start. Keep schema permissive so
  // migrateMcpConfig does not wipe existing server entries.
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.string().optional(),
  enabled: z.boolean().optional(),
})

const INPUT_TEMPLATE = /^\$\{input:([^}]+)\}$/

const withMcpTemplatePlaceholders = (value: string): string =>
  value.replace(/\$\{input:([^}]+)\}/g, 'x').replace(/\$\{env:([^}]+)\}/g, 'x')

export const isMcpTemplatableUrl = (value: string): boolean =>
  z.string().url().safeParse(withMcpTemplatePlaceholders(value)).success

const templatableUrl = z.string().refine(isMcpTemplatableUrl, {
  message: 'must be a valid URL after replacing ${input:...} and ${env:...} templates',
})

const oauthSchema = z
  .object({
    clientId: z.string().min(1).optional(),
    allowedAuthorizationServers: z.array(z.string().url()).optional(),
    clientSecret: z
      .string()
      .regex(INPUT_TEMPLATE, 'clientSecret must be a ${input:...} template')
      .optional(),
    scopes: z.array(z.string()).optional(),
    callbackPort: z.number().int().positive().optional(),
    authServerMetadataUrl: z.string().url().optional(),
  })
  .strict()

const httpServerSchema = z
  .object({
    type: z.enum(['http', 'sse']),
    url: templatableUrl,
    auth: z.enum(['none', 'headers', 'oauth']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    oauth: oauthSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.auth === 'none' && value.oauth !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'auth none cannot include an oauth block',
        path: ['oauth'],
      })
    }

    const headerKeys = value.headers ? Object.keys(value.headers) : []
    if (value.auth === 'headers' && headerKeys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'auth headers requires a non-empty headers object',
        path: ['headers'],
      })
    }
  })

const serverSchema = z.union([stdioServerSchema, httpServerSchema])

const inputSchema = z.object({
  id: z.string().min(1),
  type: z.literal('promptString'),
  description: z.string().optional(),
  password: z.boolean().optional(),
})

export const mcpConfigSchema = z.object({
  servers: z.record(z.string(), serverSchema),
  inputs: z.array(inputSchema).optional(),
})

export const defaultMcpConfig = (): z.infer<typeof mcpConfigSchema> => ({
  servers: {},
})

export const isMcpServerEnabled = (config: { enabled?: boolean }): boolean =>
  config.enabled !== false

const recoverMcpServers = (
  serversRaw: object,
): z.infer<typeof mcpConfigSchema>['servers'] => {
  const servers: z.infer<typeof mcpConfigSchema>['servers'] = {}
  for (const [id, value] of Object.entries(serversRaw)) {
    const serverParsed = serverSchema.safeParse(value)
    if (serverParsed.success) {
      servers[id] = serverParsed.data
    }
  }
  return servers
}

const withRecoveredInputs = (
  record: Record<string, unknown>,
  servers: z.infer<typeof mcpConfigSchema>['servers'],
): z.infer<typeof mcpConfigSchema> => {
  const inputsParsed = z.array(inputSchema).safeParse(record.inputs)
  return {
    servers,
    ...(inputsParsed.success && inputsParsed.data.length > 0
      ? { inputs: inputsParsed.data }
      : {}),
  }
}

export const parseMcpConfig = (raw: unknown): ParseMcpConfigResult => {
  if (raw === null || raw === undefined) {
    return { ok: true, config: defaultMcpConfig() }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'MCP config is not an object' }
  }

  const parsed = mcpConfigSchema.safeParse(raw)
  if (parsed.success) {
    return { ok: true, config: parsed.data }
  }

  const record = raw as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length === 0) {
    return { ok: true, config: defaultMcpConfig() }
  }

  const serversRaw = record.servers
  if (serversRaw === undefined) {
    return { ok: false, error: 'MCP config is missing a servers object' }
  }
  if (typeof serversRaw !== 'object' || serversRaw === null || Array.isArray(serversRaw)) {
    return { ok: false, error: 'MCP config servers is not an object' }
  }

  const servers = recoverMcpServers(serversRaw)
  const rawCount = Object.keys(serversRaw).length
  if (rawCount > 0 && Object.keys(servers).length === 0) {
    return { ok: false, error: 'MCP config servers failed to parse' }
  }

  return { ok: true, config: withRecoveredInputs(record, servers) }
}

export const migrateMcpConfig = (raw: unknown): z.infer<typeof mcpConfigSchema> => {
  const parsed = parseMcpConfig(raw)
  if (parsed.ok) {
    return parsed.config
  }
  return defaultMcpConfig()
}
