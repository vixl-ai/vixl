export type McpStdioServer = {
  command: string
  args?: string[]
  env?: Record<string, string>
  envFile?: string
  enabled?: boolean
  oauth?: never
}

export type McpOAuthConfig = {
  clientId?: string
  allowedAuthorizationServers?: string[]
}

export type McpHttpServer = {
  type: 'http' | 'sse'
  url: string
  headers?: Record<string, string>
  oauth?: McpOAuthConfig
  enabled?: boolean
}

export type McpServerConfig = McpStdioServer | McpHttpServer

export type McpInputDefinition = {
  id: string
  type: 'promptString'
  description?: string
  password?: boolean
}

export type McpConfig = {
  servers: Record<string, McpServerConfig>
  inputs?: McpInputDefinition[]
}

export type McpServerScope = 'personal' | 'project' | 'overridden'

export type McpServerStatus =
  | 'connected'
  | 'starting'
  | 'stopped'
  | 'error'
  | 'auth_required'
  | 'refreshing'

export type McpToolDescriptor = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  meta?: Record<string, unknown>
}

export const isMcpStdioServer = (
  config: McpServerConfig,
): config is McpStdioServer => 'command' in config

export const isMcpHttpServer = (
  config: McpServerConfig,
): config is McpHttpServer => 'type' in config && (config.type === 'http' || config.type === 'sse')
