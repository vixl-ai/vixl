import { toast } from 'vue-sonner'
import type { McpServerConfig } from '@/types/vixl/mcp-config'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'
import { patchServerState, resolveEffectiveServerConfig, withOptionalServerLoading } from './helpers'

const stopServer = async (
  serverId: string,
  options?: {
    quiet?: boolean
    manageLoading?: boolean
    config?: McpServerConfig
    scopeKey?: string | null
  },
): Promise<void> => {
  const run = async (): Promise<void> => {
    try {
      const resolvedConfig = await resolveEffectiveServerConfig(
        serverId,
        options?.config,
        options?.scopeKey,
      )
      await mcpRuntime.stop(serverId, resolvedConfig, options?.scopeKey)
      patchServerState(serverId, {
        serverId,
        status: 'stopped',
        tools: [],
      }, options?.scopeKey)
      if (!options?.quiet && !isInternalMcpServer(serverId)) {
        toast.success(`${serverId} stopped`)
      }
    } catch (error) {
      toast.error('Failed to stop server', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
  await withOptionalServerLoading(serverId, options?.manageLoading, run, options?.scopeKey)
}

export default stopServer
