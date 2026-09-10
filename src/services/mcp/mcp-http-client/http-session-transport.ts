import { toast } from 'vue-sonner'
import connectionKey from '@/services/mcp/connection-key'
import { applyHttpClientTools } from './apply-http-tools'
import { createHttpMcpClient } from './create-http-client'
import { httpServers, isUnauthorized, setEntryState, syncHttpChallengeFromFetch } from './store'

const reconnectLocks = new Set<string>()

const shouldAbortReconnect = (
  serverId: string,
  scopeKey?: string | null,
): boolean => {
  const current = httpServers.get(connectionKey(scopeKey, serverId))
  if (!current) {
    return true
  }
  return (
    current.state.status === 'stopped' ||
    current.state.status === 'auth_required' ||
    current.state.status === 'starting'
  )
}

const rememberSessionId = (
  serverId: string,
  sessionId: string | null,
  scopeKey?: string | null,
): void => {
  const existing = httpServers.get(connectionKey(scopeKey, serverId))
  setEntryState(
    serverId,
    { status: existing?.state.status ?? 'starting' },
    { sessionId, scopeKey: existing?.scopeKey ?? scopeKey },
  )
}

const reconnectHttpServer = async (
  serverId: string,
  scopeKey?: string | null,
): Promise<void> => {
  const lockKey = connectionKey(scopeKey, serverId)
  if (reconnectLocks.has(lockKey) || shouldAbortReconnect(serverId, scopeKey)) {
    return
  }
  reconnectLocks.add(lockKey)

  try {
    const entry = httpServers.get(lockKey)
    if (!entry) {
      return
    }

    const { config, authProvider } = entry
    const previousClient = entry.client
    setEntryState(
      serverId,
      { status: entry.state.status, tools: entry.state.tools, error: null },
      { client: null, sessionId: null, scopeKey: entry.scopeKey },
    )

    if (previousClient) {
      try {
        await previousClient.close()
      } catch (error) {
        if (isUnauthorized(error)) {
          throw error
        }
      }
    }

    if (shouldAbortReconnect(serverId, scopeKey)) {
      return
    }

    const client = await createHttpMcpClient(config, {
      authProvider,
      session:
        config.type === 'http'
          ? httpSessionTransportOptions(serverId, scopeKey)
          : undefined,
    })

    if (shouldAbortReconnect(serverId, scopeKey)) {
      await client.close()
      return
    }

    await applyHttpClientTools(serverId, client, {
      config,
      authProvider,
      scopeKey: entry.scopeKey,
    })
  } catch (error) {
    if (shouldAbortReconnect(serverId, scopeKey)) {
      return
    }
    if (isUnauthorized(error)) {
      syncHttpChallengeFromFetch(serverId, scopeKey)
      setEntryState(
        serverId,
        {
          status: 'auth_required',
          tools: [],
          error:
            error instanceof Error
              ? error.message
              : 'Authentication required',
        },
        { client: null, sessionId: null, scopeKey },
      )
      return
    }

    const message =
      error instanceof Error ? error.message : 'MCP session reconnect failed'
    toast.error('MCP session expired', { description: message })
    setEntryState(
      serverId,
      { status: 'error', tools: [], error: message },
      { client: null, sessionId: null, scopeKey },
    )
  } finally {
    reconnectLocks.delete(lockKey)
  }
}

export const httpSessionTransportOptions = (
  serverId: string,
  scopeKey?: string | null,
) => ({
  terminateSessionOnClose: true as const,
  onSessionIdChange: (sessionId: string | undefined): void => {
    rememberSessionId(serverId, sessionId ?? null, scopeKey)
  },
  onSessionExpired: (expiredSessionId: string): void => {
    const existing = httpServers.get(connectionKey(scopeKey, serverId))
    if (existing?.sessionId && existing.sessionId !== expiredSessionId) {
      return
    }
    rememberSessionId(serverId, null, scopeKey)
    reconnectHttpServer(serverId, scopeKey).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'MCP session reconnect failed'
      toast.error('MCP session expired', { description: message })
      if (shouldAbortReconnect(serverId, scopeKey)) {
        return
      }
      setEntryState(
        serverId,
        { status: 'error', error: message },
        { sessionId: null, scopeKey },
      )
    })
  },
})
