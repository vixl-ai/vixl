import { toast } from 'vue-sonner'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import connectionKey from '@/services/mcp/connection-key'
import { patchServerState } from './helpers'
import { authenticatingServers } from './state'

const cancelAuthenticateServer = (
  serverId: string,
  scopeKey?: string | null,
): void => {
  mcpRuntime.cancelAuthenticate(serverId, scopeKey)
  patchServerState(serverId, {
    serverId,
    status: 'auth_required',
    tools: [],
    error: 'Authentication cancelled',
  }, scopeKey)
  authenticatingServers.value = {
    ...authenticatingServers.value,
    [connectionKey(scopeKey, serverId)]: false,
  }
  toast.success('Authentication cancelled')
}

export default cancelAuthenticateServer
