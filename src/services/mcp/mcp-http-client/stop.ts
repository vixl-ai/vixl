import type { McpHttpServer } from '@/types/vixl/mcp-config'
import type { McpServerState } from '@/services/vixl/vixl-tauri'
import { httpServers, setEntryState } from './store'

export const stopHttpServer = async (serverId: string): Promise<void> => {
  const entry = httpServers.get(serverId)
  if (!entry) {
    return
  }

  if (entry.client) {
    try {
      await entry.client.close()
    } catch {
      // Client may already be closed.
    }
  }

  setEntryState(
    serverId,
    { status: 'stopped', tools: [], error: null },
    { client: null, config: entry.config, authProvider: entry.authProvider },
  )
}

export const markHttpAuthRequired = (
  serverId: string,
  config: McpHttpServer,
  error?: string | null,
): McpServerState =>
  setEntryState(
    serverId,
    {
      status: 'auth_required',
      tools: [],
      error: error ?? null,
    },
    { client: null, config, authProvider: undefined },
  )

export const logoutHttpServer = async (
  serverId: string,
  config?: McpHttpServer,
): Promise<McpServerState> => {
  const entry = httpServers.get(serverId)
  if (entry?.client) {
    try {
      await entry.client.close()
    } catch {
      // Client may already be closed.
    }
  }

  return setEntryState(
    serverId,
    { status: 'auth_required', tools: [], error: null },
    {
      client: null,
      config: config ?? entry?.config ?? { type: 'http', url: '' },
      authProvider: undefined,
    },
  )
}
