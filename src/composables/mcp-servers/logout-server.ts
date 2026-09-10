import { toast } from 'vue-sonner'
import type { McpServerConfig } from '@/types/vixl/mcp-config'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { patchServerState, resolveEffectiveServerConfig } from './helpers'

const logoutServer = async (
  serverId: string,
  config?: McpServerConfig,
  scopeKey?: string | null,
): Promise<void> => {
  try {
    const resolvedConfig = await resolveEffectiveServerConfig(
      serverId,
      config,
      scopeKey,
    )
    await mcpRuntime.logout(serverId, resolvedConfig, scopeKey)
    patchServerState(serverId, {
      serverId,
      status: 'auth_required',
      tools: [],
    }, scopeKey)
  } catch (error) {
    toast.error('Failed to log out', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

export default logoutServer
