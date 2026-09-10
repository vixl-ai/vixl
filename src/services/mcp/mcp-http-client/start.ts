import type { OAuthClientProvider } from '@ai-sdk/mcp'
import type { McpHttpServer } from '@/types/vixl/mcp-config'
import { isAllowedMcpUrl } from '@/services/mcp/is-allowed-mcp-url'
import isDcrMissingClientError from '@/services/mcp/oauth/is-dcr-missing-client'
import connectionKey from '@/services/mcp/connection-key'
import type { McpServerState } from '@/services/vixl/vixl-tauri'
import { applyHttpClientTools } from './apply-http-tools'
import { createHttpMcpClient } from './create-http-client'
import { httpSessionTransportOptions } from './http-session-transport'
import {
  httpServers,
  iconsFromClient,
  isUnauthorized,
  setEntryState,
  syncHttpChallengeFromFetch,
  toToolInfo,
} from './store'
import { stopHttpServer } from './stop'

export const startHttpServer = async (
  serverId: string,
  config: McpHttpServer,
  options?: { authProvider?: OAuthClientProvider; scopeKey?: string | null },
): Promise<McpServerState> => {
  if (!isAllowedMcpUrl(config.url)) {
    throw new Error(
      'MCP URL must use https, or http on localhost / 127.0.0.1',
    )
  }

  const scopeKey = options?.scopeKey
  await stopHttpServer(serverId, scopeKey)
  setEntryState(
    serverId,
    { status: 'starting', tools: [], error: null },
    {
      client: null,
      config,
      authProvider: options?.authProvider,
      sessionId: null,
      scopeKey,
    },
  )

  try {
    const client = await createHttpMcpClient(config, {
      authProvider: options?.authProvider,
      session:
        config.type === 'http'
          ? httpSessionTransportOptions(serverId, scopeKey)
          : undefined,
    })
    return await applyHttpClientTools(serverId, client, {
      config,
      authProvider: options?.authProvider,
      scopeKey,
    })
  } catch (error) {
    syncHttpChallengeFromFetch(serverId, scopeKey)
    if (isUnauthorized(error) || isDcrMissingClientError(error)) {
      return setEntryState(
        serverId,
        {
          status: 'auth_required',
          tools: [],
          error:
            error instanceof Error
              ? error.message
              : 'Authentication required',
        },
        {
          client: null,
          config,
          authProvider: options?.authProvider,
          sessionId: null,
          scopeKey,
        },
      )
    }

    const message = error instanceof Error ? error.message : 'Failed to connect'
    setEntryState(
      serverId,
      { status: 'error', tools: [], error: message },
      {
        client: null,
        config,
        authProvider: options?.authProvider,
        sessionId: null,
        scopeKey,
      },
    )
    throw error instanceof Error ? error : new Error(message)
  }
}

export const refreshHttpServer = async (
  serverId: string,
  scopeKey?: string | null,
): Promise<McpServerState> => {
  const entry = httpServers.get(connectionKey(scopeKey, serverId))
  if (!entry?.client) {
    throw new Error('Server not running')
  }

  const extras = { scopeKey: entry.scopeKey }
  setEntryState(serverId, {
    status: 'refreshing',
    tools: entry.state.tools,
    error: null,
  }, extras)

  try {
    const listed = await entry.client.listTools()
    const tools = listed.tools.map(toToolInfo)
    const icons = iconsFromClient(entry.client)
    return setEntryState(serverId, {
      status: 'connected',
      tools,
      icons,
      error: null,
    }, extras)
  } catch (error) {
    syncHttpChallengeFromFetch(serverId, scopeKey)
    if (isUnauthorized(error)) {
      return setEntryState(serverId, {
        status: 'auth_required',
        tools: [],
        error:
          error instanceof Error
            ? error.message
            : 'Authentication required',
      }, extras)
    }
    const message = error instanceof Error ? error.message : 'Refresh failed'
    setEntryState(serverId, {
      status: 'error',
      tools: entry.state.tools,
      error: message,
    }, extras)
    throw error instanceof Error ? error : new Error(message)
  }
}
