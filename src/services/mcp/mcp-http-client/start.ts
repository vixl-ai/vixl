import type { OAuthClientProvider } from '@ai-sdk/mcp'
import type { McpHttpServer } from '@/types/vixl/mcp-config'
import { isAllowedMcpUrl } from '@/services/mcp/is-allowed-mcp-url'
import { detectMcpToolDrift } from '@/services/mcp/mcp-tool-baseline'
import isDcrMissingClientError from '@/services/mcp/oauth/is-dcr-missing-client'
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
  options?: { authProvider?: OAuthClientProvider },
): Promise<McpServerState> => {
  if (!isAllowedMcpUrl(config.url)) {
    throw new Error(
      'MCP URL must use https, or http on localhost / 127.0.0.1',
    )
  }

  await stopHttpServer(serverId)
  setEntryState(
    serverId,
    { status: 'starting', tools: [], error: null },
    {
      client: null,
      config,
      authProvider: options?.authProvider,
      sessionId: null,
    },
  )

  try {
    const client = await createHttpMcpClient(config, {
      authProvider: options?.authProvider,
      session:
        config.type === 'http'
          ? httpSessionTransportOptions(serverId)
          : undefined,
    })
    return await applyHttpClientTools(serverId, client, {
      config,
      authProvider: options?.authProvider,
    })
  } catch (error) {
    syncHttpChallengeFromFetch(serverId)
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
      },
    )
    throw error instanceof Error ? error : new Error(message)
  }
}

export const refreshHttpServer = async (
  serverId: string,
): Promise<McpServerState> => {
  const entry = httpServers.get(serverId)
  if (!entry?.client) {
    throw new Error('Server not running')
  }

  setEntryState(serverId, {
    status: 'refreshing',
    tools: entry.state.tools,
    error: null,
  })

  try {
    const listed = await entry.client.listTools()
    const tools = listed.tools.map(toToolInfo)
    const icons = iconsFromClient(entry.client)
    const fingerprintSources = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
    const drift = await detectMcpToolDrift(serverId, fingerprintSources)
    if (drift.drifted) {
      await entry.client.close()
      return setEntryState(
        serverId,
        {
          status: 'error',
          tools,
          icons,
          error: `Tool definitions changed (${[...drift.changed, ...drift.added].join(', ') || 'unknown'}). Re-trust this server in Settings.`,
        },
        { client: null, sessionId: null },
      )
    }
    return setEntryState(serverId, {
      status: 'connected',
      tools,
      icons,
      error: null,
    })
  } catch (error) {
    syncHttpChallengeFromFetch(serverId)
    if (isUnauthorized(error)) {
      return setEntryState(serverId, {
        status: 'auth_required',
        tools: [],
        error:
          error instanceof Error
            ? error.message
            : 'Authentication required',
      })
    }
    const message = error instanceof Error ? error.message : 'Refresh failed'
    setEntryState(serverId, {
      status: 'error',
      tools: entry.state.tools,
      error: message,
    })
    throw error instanceof Error ? error : new Error(message)
  }
}
