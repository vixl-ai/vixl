import { toast } from 'vue-sonner'
import type { McpServerConfig } from '@/types/vixl/mcp-config'
import createRefreshOrStartServer from './create-refresh-or-start-server'

const createRefreshAllServers = (
  refreshOrStartServer: ReturnType<typeof createRefreshOrStartServer>,
) => async (
  servers: Array<{ id: string; config: McpServerConfig }>,
): Promise<void> => {
  for (const server of servers) {
    await refreshOrStartServer(server.id, server.config, { quiet: true })
  }
  toast.success('All servers refreshed')
}

export default createRefreshAllServers
