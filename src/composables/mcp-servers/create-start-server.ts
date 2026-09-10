import { toast } from 'vue-sonner'
import type { McpServerConfig } from '@/types/vixl/mcp-config'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import connectionKey from '@/services/mcp/connection-key'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'
import { patchServerState, withOptionalServerLoading } from './helpers'
import { startInFlight } from './state'
import createAssertTrustedOrThrow from './create-assert-trusted-or-throw'
import createRuntimeOptions from './create-runtime-options'

const createStartServer = (
  assertTrustedOrThrow: ReturnType<typeof createAssertTrustedOrThrow>,
  runtimeOptions: ReturnType<typeof createRuntimeOptions>,
) => async (
  serverId: string,
  serverConfig: McpServerConfig,
  options?: {
    quiet?: boolean
    manageLoading?: boolean
    settings?: VixlSettings
    scopeKey?: string | null
  },
): Promise<void> => {
  const flightKey = connectionKey(options?.scopeKey, serverId)
  const existing = startInFlight.get(flightKey)
  if (existing) {
    await existing
    return
  }

  const run = async (): Promise<void> => {
    try {
      assertTrustedOrThrow(serverId, serverConfig, options?.settings, options?.scopeKey)
      const state = await mcpRuntime.start(
        serverId,
        serverConfig,
        runtimeOptions({
          ...(options?.settings !== undefined ? { settings: options.settings } : {}),
          ...(options?.scopeKey !== undefined ? { scopeKey: options.scopeKey } : {}),
        }),
      )
      patchServerState(serverId, state, options?.scopeKey)
      if (!options?.quiet && !isInternalMcpServer(serverId)) {
        toast.success(`${serverId} connected (${state.tools.length} tools)`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patchServerState(serverId, {
        serverId,
        status: 'error',
        tools: [],
        error: message,
      }, options?.scopeKey)
      if (!options?.quiet) {
        toast.error('Failed to start server', {
          description: message,
        })
        return
      }
      throw error instanceof Error ? error : new Error(message)
    }
  }

  const pending = (async () => {
    try {
      await withOptionalServerLoading(
        serverId,
        options?.manageLoading,
        run,
        options?.scopeKey,
      )
    } finally {
      startInFlight.delete(flightKey)
    }
  })()
  startInFlight.set(flightKey, pending)
  await pending
}

export default createStartServer
