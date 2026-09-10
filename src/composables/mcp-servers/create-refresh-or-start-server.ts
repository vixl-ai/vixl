import type { McpServerConfig } from '@/types/vixl/mcp-config'
import connectionKey from '@/services/mcp/connection-key'
import { serverStates } from './state'
import createStartServer from './create-start-server'
import refreshServer from './refresh-server'

const createRefreshOrStartServer = (
  startServer: ReturnType<typeof createStartServer>,
) => async (
  serverId: string,
  config: McpServerConfig,
  options?: { quiet?: boolean; scopeKey?: string | null },
): Promise<void> => {
  const key = connectionKey(options?.scopeKey, serverId)
  const status = serverStates.value[key]?.status ?? 'stopped'
  if (status === 'connected') {
    await refreshServer(serverId, config, options)
    return
  }
  await startServer(serverId, config, options)
}

export default createRefreshOrStartServer
