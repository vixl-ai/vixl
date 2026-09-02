import type { OAuthClientProvider } from '@ai-sdk/mcp'
import type { McpHttpServer, McpServerConfig } from '@/types/vixl/mcp-config'
import { isMcpHttpServer, isMcpStdioServer } from '@/types/vixl/mcp-config'
import { isAllowedMcpUrl } from '@/services/mcp/is-allowed-mcp-url'
import { assertSafeMcpEnvOverlay } from '@/services/mcp/mcp-dangerous-env'
import {
  hasHttpServer,
  logoutHttpServer,
  markHttpAuthRequired,
  refreshHttpServer,
  startHttpServer,
  stopHttpServer,
} from '@/services/mcp/mcp-http-client'
import { resolveServerTemplates } from '@/services/mcp/resolve-mcp-inputs'
import {
  mcpLogout,
  mcpRefresh,
  mcpStart,
  mcpStop,
  type McpServerState,
} from '@/services/vixl/vixl-tauri'
import { assertServerTrusted, clearServerSecrets } from './trust'
import { createTokenProvider } from './oauth'
import type { McpRuntimeOptions } from './types'

export const startHttp = async (
  serverId: string,
  config: McpHttpServer,
  options?: McpRuntimeOptions,
  authProvider?: OAuthClientProvider,
): Promise<McpServerState> => {
  assertServerTrusted(serverId, config, options)

  if (!isAllowedMcpUrl(config.url)) {
    throw new Error(
      'MCP URL must use https, or http on localhost / 127.0.0.1',
    )
  }

  let headers: Record<string, string> | undefined
  try {
    const resolved = await resolveServerTemplates(serverId, config)
    headers = resolved.headers
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Missing MCP inputs')
    ) {
      markHttpAuthRequired(serverId, config, 'auth_required:inputs')
      throw new Error('auth_required:inputs')
    }
    throw error
  }

  const resolvedConfig: McpHttpServer = {
    ...config,
    headers,
  }

  const provider =
    authProvider ??
    createTokenProvider(
      serverId,
      resolvedConfig,
      'http://127.0.0.1/oauth-pending',
      async () => {
        throw new Error('OAuth redirect requires authenticate()')
      },
      options?.confirmAuthorizationServerOrigin,
    )

  try {
    return await startHttpServer(serverId, resolvedConfig, {
      authProvider: provider,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      /unauthorized|401|auth_required|not confirmed|oauth redirect requires authenticate/i.test(
        message,
      ) ||
      error instanceof Error && error.name === 'UnauthorizedError'
    ) {
      return markHttpAuthRequired(serverId, resolvedConfig, message)
    }
    throw error
  }
}

export const startStdio = async (
  serverId: string,
  config: Extract<McpServerConfig, { command: string }>,
  options?: McpRuntimeOptions,
): Promise<McpServerState> => {
  assertServerTrusted(serverId, config, options)

  let args = config.args ?? []
  let serverEnv: Record<string, string> | undefined
  try {
    const resolved = await resolveServerTemplates(serverId, config)
    if (resolved.args) {
      args = resolved.args
    }
    if (resolved.serverEnv) {
      serverEnv = assertSafeMcpEnvOverlay(resolved.serverEnv)
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Missing MCP inputs')
    ) {
      throw new Error('auth_required:inputs')
    }
    throw error
  }

  return mcpStart(serverId, config.command, args, serverEnv)
}

export const start = async (
  serverId: string,
  config: McpServerConfig,
  options?: McpRuntimeOptions,
): Promise<McpServerState> => {
  if (isMcpHttpServer(config)) {
    return startHttp(serverId, config, options)
  }
  if (isMcpStdioServer(config)) {
    return startStdio(serverId, config, options)
  }
  throw new Error('Unsupported MCP server config')
}

export const stop = async (
  serverId: string,
  config?: McpServerConfig,
): Promise<void> => {
  if (config ? isMcpHttpServer(config) : hasHttpServer(serverId)) {
    await stopHttpServer(serverId)
    return
  }
  await mcpStop(serverId)
}

export const refresh = async (
  serverId: string,
  config?: McpServerConfig,
): Promise<McpServerState> => {
  if (config ? isMcpHttpServer(config) : hasHttpServer(serverId)) {
    return refreshHttpServer(serverId)
  }
  return mcpRefresh(serverId)
}

export const logout = async (
  serverId: string,
  config?: McpServerConfig,
): Promise<void> => {
  await clearServerSecrets(serverId, config)

  if (config ? isMcpHttpServer(config) : hasHttpServer(serverId)) {
    await logoutHttpServer(
      serverId,
      config && isMcpHttpServer(config) ? config : undefined,
    )
    return
  }

  await mcpLogout(serverId)
}
