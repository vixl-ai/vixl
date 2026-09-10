import { toast } from 'vue-sonner'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { patchServerState } from './helpers'
import { authenticatingServers } from './state'

const cancelAuthenticateServer = (serverId: string): void => {
  mcpRuntime.cancelAuthenticate(serverId)
  patchServerState(serverId, {
    serverId,
    status: 'auth_required',
    tools: [],
    error: 'Authentication cancelled',
  })
  authenticatingServers.value = {
    ...authenticatingServers.value,
    [serverId]: false,
  }
  toast.success('Authentication cancelled')
}

export default cancelAuthenticateServer
