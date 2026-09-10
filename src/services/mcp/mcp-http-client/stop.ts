import type { McpHttpServer } from '@/types/vixl/mcp-config'
import type { McpServerState } from '@/services/vixl/vixl-tauri'
import connectionKey from '@/services/mcp/connection-key'
import { httpServers, setEntryState } from './store'

export const stopHttpServer = async (
  serverId: string,
  scopeKey?: string | null,
): Promise<void> => {
  const entry = httpServers.get(connectionKey(scopeKey, serverId))
  if (!entry) {
    return
  }

  if (entry.client) {
    try {
      await entry.client.close()
    } catch {
      entry.client = null
    }
  }

  setEntryState(
    serverId,
    { status: 'stopped', tools: [], error: null },
    {
      client: null,
      config: entry.config,
      authProvider: entry.authProvider,
      sessionId: null,
      scopeKey: entry.scopeKey,
    },
  )
}

export const markHttpAuthRequired = (
  serverId: string,
  config: McpHttpServer,
  error?: string | null,
  scopeKey?: string | null,
): McpServerState =>
  setEntryState(
    serverId,
    {
      status: 'auth_required',
      tools: [],
      error: error ?? null,
    },
    {
      client: null,
      config,
      authProvider: undefined,
      sessionId: null,
      scopeKey,
    },
  )

export const logoutHttpServer = async (
  serverId: string,
  config?: McpHttpServer,
  scopeKey?: string | null,
): Promise<McpServerState> => {
  const entry = httpServers.get(connectionKey(scopeKey, serverId))
  if (entry?.client) {
    try {
      await entry.client.close()
    } catch {
      entry.client = null
    }
  }

  return setEntryState(
    serverId,
    { status: 'auth_required', tools: [], error: null },
    {
      client: null,
      config: config ?? entry?.config ?? { type: 'http', url: '' },
      authProvider: undefined,
      sessionId: null,
      scopeKey: entry?.scopeKey ?? scopeKey,
    },
  )
}
