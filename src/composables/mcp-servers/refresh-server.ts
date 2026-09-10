import { toast } from 'vue-sonner'
import type { McpServerConfig } from '@/types/vixl/mcp-config'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'
import { patchServerState, resolveEffectiveServerConfig, withServerLoading } from './helpers'

const refreshServer = async (
  serverId: string,
  config?: McpServerConfig,
  options?: { quiet?: boolean; scopeKey?: string | null },
): Promise<void> => {
  await withServerLoading(serverId, async () => {
    try {
      const resolvedConfig = await resolveEffectiveServerConfig(
        serverId,
        config,
        options?.scopeKey,
      )
      const state = await mcpRuntime.refresh(
        serverId,
        resolvedConfig,
        options?.scopeKey,
      )
      patchServerState(serverId, state, options?.scopeKey)
      if (!options?.quiet && !isInternalMcpServer(serverId)) {
        toast.success(`${serverId} refreshed (${state.tools.length} tools)`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('Refresh failed', {
        description: message,
      })
      const notRunning = message.includes('Server not running')
      patchServerState(serverId, {
        serverId,
        status: notRunning ? 'stopped' : 'error',
        tools: [],
        error: message,
      }, options?.scopeKey)
    }
  }, options?.scopeKey)
}

export default refreshServer
