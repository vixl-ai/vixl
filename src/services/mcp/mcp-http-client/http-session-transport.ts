import { toast } from 'vue-sonner'
import { applyHttpClientTools } from './apply-http-tools'
import { createHttpMcpClient } from './create-http-client'
import { httpServers, isUnauthorized, setEntryState, syncHttpChallengeFromFetch } from './store'

const reconnectLocks = new Set<string>()

const shouldAbortReconnect = (serverId: string): boolean => {
  const current = httpServers.get(serverId)
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
): void => {
  const existing = httpServers.get(serverId)
  setEntryState(
    serverId,
    { status: existing?.state.status ?? 'starting' },
    { sessionId },
  )
}

const reconnectHttpServer = async (serverId: string): Promise<void> => {
  if (reconnectLocks.has(serverId) || shouldAbortReconnect(serverId)) {
    return
  }
  reconnectLocks.add(serverId)

  try {
    const entry = httpServers.get(serverId)
    if (!entry) {
      return
    }

    const { config, authProvider } = entry
    const previousClient = entry.client
    setEntryState(
      serverId,
      { status: entry.state.status, tools: entry.state.tools, error: null },
      { client: null, sessionId: null },
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

    if (shouldAbortReconnect(serverId)) {
      return
    }

    const client = await createHttpMcpClient(config, {
      authProvider,
      session:
        config.type === 'http'
          ? httpSessionTransportOptions(serverId)
          : undefined,
    })

    if (shouldAbortReconnect(serverId)) {
      await client.close()
      return
    }

    await applyHttpClientTools(serverId, client, { config, authProvider })
  } catch (error) {
    if (shouldAbortReconnect(serverId)) {
      return
    }
    if (isUnauthorized(error)) {
      syncHttpChallengeFromFetch(serverId)
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
        { client: null, sessionId: null },
      )
      return
    }

    const message =
      error instanceof Error ? error.message : 'MCP session reconnect failed'
    toast.error('MCP session expired', { description: message })
    setEntryState(
      serverId,
      { status: 'error', tools: [], error: message },
      { client: null, sessionId: null },
    )
  } finally {
    reconnectLocks.delete(serverId)
  }
}

export const httpSessionTransportOptions = (serverId: string) => ({
  terminateSessionOnClose: true as const,
  onSessionIdChange: (sessionId: string | undefined): void => {
    rememberSessionId(serverId, sessionId ?? null)
  },
  onSessionExpired: (expiredSessionId: string): void => {
    const existing = httpServers.get(serverId)
    if (existing?.sessionId && existing.sessionId !== expiredSessionId) {
      return
    }
    rememberSessionId(serverId, null)
    reconnectHttpServer(serverId).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'MCP session reconnect failed'
      toast.error('MCP session expired', { description: message })
      if (shouldAbortReconnect(serverId)) {
        return
      }
      setEntryState(
        serverId,
        { status: 'error', error: message },
        { sessionId: null },
      )
    })
  },
})
