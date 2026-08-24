import { toast } from 'vue-sonner'
import type { McpServerConfig } from '@/types/vixl/mcp-config'
import { listEffectiveMcpServers } from '@/services/mcp/merge-mcp-config'
import mcpRuntime, { type McpRuntimeOptions } from '@/services/mcp/mcp-runtime'
import { resolveMcpAuthForServer } from '@/services/mcp/mcp-auth-gate'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import useVixlConfig from '@/composables/use-vixl-config'
import { patchServerState, withServerLoading } from './helpers'
import {
  authenticatingServers,
  personalMcp,
  projectMcp,
  serverStates,
  startInFlight,
} from './state'

export const createRuntimeOptions = (
  config: ReturnType<typeof useVixlConfig>,
) => (
  extras?: Pick<McpRuntimeOptions, 'confirmAuthorizationServerOrigin' | 'skipTrustCheck'>,
): McpRuntimeOptions => ({
  settings: config.effectiveSettings.value as VixlSettings,
  ...extras,
})

export const createAssertTrustedOrThrow = (
  config: ReturnType<typeof useVixlConfig>,
) => (serverId: string, serverConfig: McpServerConfig): void => {
  if (isInternalMcpServer(serverId)) {
    return
  }
  const fingerprint = mcpServerFingerprint(serverConfig)
  if (
    !isMcpTrusted(
      config.effectiveSettings.value,
      serverId,
      fingerprint,
      sessionTrusts,
    )
  ) {
    throw new Error(
      `MCP server "${serverId}" is not trusted for the current configuration`,
    )
  }
}

type RuntimeOptionsFn = ReturnType<typeof createRuntimeOptions>
type AssertTrustedFn = ReturnType<typeof createAssertTrustedOrThrow>

export const createStartServer = (
  assertTrustedOrThrow: AssertTrustedFn,
  runtimeOptions: RuntimeOptionsFn,
) => async (
  serverId: string,
  serverConfig: McpServerConfig,
  options?: { quiet?: boolean; manageLoading?: boolean },
): Promise<void> => {
  const existing = startInFlight.get(serverId)
  if (existing) {
    await existing
    return
  }

  const run = async (): Promise<void> => {
    try {
      assertTrustedOrThrow(serverId, serverConfig)
      const state = await mcpRuntime.start(
        serverId,
        serverConfig,
        runtimeOptions(),
      )
      patchServerState(serverId, state)
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
      })
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
      if (options?.manageLoading === false) {
        await run()
        return
      }
      await withServerLoading(serverId, run)
    } finally {
      startInFlight.delete(serverId)
    }
  })()
  startInFlight.set(serverId, pending)
  await pending
}

export const refreshServer = async (
  serverId: string,
  config?: McpServerConfig,
  options?: { quiet?: boolean },
): Promise<void> => {
  await withServerLoading(serverId, async () => {
    try {
      const resolvedConfig =
        config ??
        listEffectiveMcpServers(personalMcp.value, projectMcp.value).find(
          (server) => server.id === serverId,
        )?.config
      const state = await mcpRuntime.refresh(serverId, resolvedConfig)
      patchServerState(serverId, state)
      if (!options?.quiet && !isInternalMcpServer(serverId)) {
        toast.success(`${serverId} refreshed (${state.tools.length} tools)`)
      }
    } catch (error) {
      toast.error('Refresh failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
}

export const createRefreshOrStartServer = (
  startServer: ReturnType<typeof createStartServer>,
) => async (
  serverId: string,
  config: McpServerConfig,
  options?: { quiet?: boolean },
): Promise<void> => {
  const status = serverStates.value[serverId]?.status ?? 'stopped'
  if (status === 'connected' || status === 'error' || status === 'refreshing') {
    await refreshServer(serverId, config, options)
    return
  }
  await startServer(serverId, config, options)
}

export const createRefreshAllServers = (
  refreshOrStartServer: ReturnType<typeof createRefreshOrStartServer>,
) => async (
  servers: Array<{ id: string; config: McpServerConfig }>,
): Promise<void> => {
  for (const server of servers) {
    await refreshOrStartServer(server.id, server.config, { quiet: true })
  }
  toast.success('All servers refreshed')
}

export const createAuthenticateServer = (
  assertTrustedOrThrow: AssertTrustedFn,
  runtimeOptions: RuntimeOptionsFn,
) => async (
  serverId: string,
  serverConfig: McpServerConfig,
  extras?: Pick<McpRuntimeOptions, 'confirmAuthorizationServerOrigin'>,
): Promise<void> => {
  authenticatingServers.value = {
    ...authenticatingServers.value,
    [serverId]: true,
  }
  await withServerLoading(serverId, async () => {
    try {
      assertTrustedOrThrow(serverId, serverConfig)
      const state = await mcpRuntime.authenticate(
        serverId,
        serverConfig,
        runtimeOptions(extras),
      )
      patchServerState(serverId, state)
      resolveMcpAuthForServer(serverId, { action: 'authenticated' })
      toast.success(`${serverId} authenticated`)
    } catch (error) {
      patchServerState(serverId, {
        serverId,
        status: 'auth_required',
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error('Authentication failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      throw error
    } finally {
      authenticatingServers.value = {
        ...authenticatingServers.value,
        [serverId]: false,
      }
    }
  })
}

export const logoutServer = async (
  serverId: string,
  config?: McpServerConfig,
): Promise<void> => {
  try {
    const resolvedConfig =
      config ??
      listEffectiveMcpServers(personalMcp.value, projectMcp.value).find(
        (server) => server.id === serverId,
      )?.config
    await mcpRuntime.logout(serverId, resolvedConfig)
    patchServerState(serverId, {
      serverId,
      status: 'auth_required',
      tools: [],
    })
  } catch (error) {
    toast.error('Failed to log out', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

export const stopServer = async (
  serverId: string,
  options?: { quiet?: boolean; manageLoading?: boolean; config?: McpServerConfig },
): Promise<void> => {
  const run = async (): Promise<void> => {
    try {
      const resolvedConfig =
        options?.config ??
        listEffectiveMcpServers(personalMcp.value, projectMcp.value).find(
          (server) => server.id === serverId,
        )?.config
      await mcpRuntime.stop(serverId, resolvedConfig)
      patchServerState(serverId, {
        serverId,
        status: 'stopped',
        tools: [],
      })
      if (!options?.quiet && !isInternalMcpServer(serverId)) {
        toast.success(`${serverId} stopped`)
      }
    } catch (error) {
      toast.error('Failed to stop server', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  if (options?.manageLoading === false) {
    await run()
    return
  }
  await withServerLoading(serverId, run)
}
