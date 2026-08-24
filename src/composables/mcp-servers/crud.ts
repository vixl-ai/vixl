import { toast } from 'vue-sonner'
import type { McpConfig, McpServerConfig } from '@/types/vixl/mcp-config'
import type { McpInputDefinition } from '@/types/vixl/mcp-config'
import { listEffectiveMcpServers } from '@/services/mcp/merge-mcp-config'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { listRequiredInputIdsForServer } from '@/services/mcp/resolve-mcp-inputs'
import { mcpKnownSecretKeys } from '@/services/mcp/mcp-keychain-keys'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import { sessionTrusts } from '@/services/mcp/mcp-trust'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'
import { deleteSecret } from '@/services/vixl/vixl-tauri'
import type { SettingsTab } from '@/composables/use-vixl-config'
import { withServerLoading } from './helpers'
import { saveScopedConfig, refreshStates } from './config'
import { personalMcp, projectMcp } from './state'
import { createStartServer, stopServer } from './lifecycle'

type AssertTrustedFn = (
  serverId: string,
  serverConfig: McpServerConfig,
) => void

type StartServerFn = ReturnType<typeof createStartServer>

export const addServer = async (
  tab: SettingsTab,
  serverId: string,
  config: McpServerConfig,
  rootPath: string | null,
): Promise<void> => {
  if (isInternalMcpServer(serverId)) {
    throw new Error(`Reserved MCP server id "${serverId}"`)
  }
  const scoped = tab === 'personal' ? personalMcp.value : projectMcp.value
  const next = {
    servers: {
      ...scoped.servers,
      [serverId]: config,
    },
  }
  await saveScopedConfig(tab, next, rootPath)
  await refreshStates()
}

export const upsertServer = async (
  tab: SettingsTab,
  serverId: string,
  serverConfig: McpServerConfig,
  rootPath: string | null,
  options?: {
    previousId?: string
    inputs?: McpInputDefinition[]
  },
): Promise<void> => {
  if (isInternalMcpServer(serverId) || (options?.previousId && isInternalMcpServer(options.previousId))) {
    throw new Error(`Reserved MCP server id "${serverId}"`)
  }
  const scoped = tab === 'personal' ? personalMcp.value : projectMcp.value
  const nextServers = { ...scoped.servers }
  const previousId = options?.previousId

  if (previousId && previousId !== serverId) {
    delete nextServers[previousId]
    await mcpRuntime.stop(previousId)
    const previous = scoped.servers[previousId]
    if (previous) {
      for (const key of mcpKnownSecretKeys(
        previousId,
        listRequiredInputIdsForServer(previous),
      )) {
        try {
          await deleteSecret(key)
        } catch {
          // Best-effort.
        }
      }
    }
  }

  const existing = previousId
    ? scoped.servers[previousId]
    : scoped.servers[serverId]
  if (
    existing &&
    mcpServerFingerprint(existing) !== mcpServerFingerprint(serverConfig)
  ) {
    for (const key of mcpKnownSecretKeys(
      previousId && previousId !== serverId ? previousId : serverId,
      listRequiredInputIdsForServer(existing),
    )) {
      try {
        await deleteSecret(key)
      } catch {
        // Best-effort on fingerprint change.
      }
    }
    sessionTrusts.delete(serverId)
    if (previousId) {
      sessionTrusts.delete(previousId)
    }
  }

  nextServers[serverId] = serverConfig

  let nextInputs = scoped.inputs
  if (options?.inputs) {
    const byId = new Map((scoped.inputs ?? []).map((item) => [item.id, item]))
    for (const item of options.inputs) {
      byId.set(item.id, item)
    }
    nextInputs = [...byId.values()]
  }

  await saveScopedConfig(
    tab,
    {
      servers: nextServers,
      ...(nextInputs && nextInputs.length > 0 ? { inputs: nextInputs } : {}),
    },
    rootPath,
  )
  await refreshStates()
}

export const deleteServer = async (
  tab: SettingsTab,
  serverId: string,
  rootPath: string | null,
): Promise<void> => {
  const scoped = tab === 'personal' ? personalMcp.value : projectMcp.value
  const removed = scoped.servers[serverId]
  const { [serverId]: _removed, ...rest } = scoped.servers
  await saveScopedConfig(tab, { servers: rest }, rootPath)
  await mcpRuntime.stop(serverId, removed)
  if (removed) {
    const inputIds = listRequiredInputIdsForServer(removed)
    for (const key of mcpKnownSecretKeys(serverId, inputIds)) {
      try {
        await deleteSecret(key)
      } catch {
        // Best-effort keychain cleanup.
      }
    }
  }
  await refreshStates()
}

export const updateServer = async (
  tab: SettingsTab,
  serverId: string,
  serverConfig: McpServerConfig,
  rootPath: string | null,
  previousId?: string,
): Promise<void> => {
  await upsertServer(tab, serverId, serverConfig, rootPath, { previousId })
}

export const createSetServerEnabled = (
  assertTrustedOrThrow: AssertTrustedFn,
  startServer: StartServerFn,
) => async (
  serverId: string,
  enabled: boolean,
  rootPath: string | null,
): Promise<void> => {
  const effective = listEffectiveMcpServers(personalMcp.value, projectMcp.value)
  const server = effective.find((item) => item.id === serverId)
  if (!server) {
    toast.error('MCP server not found', {
      description: serverId,
    })
    return
  }

  if (enabled) {
    assertTrustedOrThrow(serverId, server.config)
  }

  const tab: SettingsTab =
    server.scope === 'personal' ? 'personal' : 'project'
  const scoped = tab === 'personal' ? personalMcp.value : projectMcp.value
  const existing = scoped.servers[serverId]
  if (!existing) {
    toast.error('MCP server config missing', {
      description: `${serverId} (${tab})`,
    })
    return
  }

  if (tab === 'project' && !rootPath) {
    toast.error('Select a project to update this MCP server')
    return
  }

  const nextConfig: McpServerConfig = { ...existing, enabled }
  const nextScoped: McpConfig = {
    servers: {
      ...scoped.servers,
      [serverId]: nextConfig,
    },
  }

  if (tab === 'personal') {
    personalMcp.value = nextScoped
  } else {
    projectMcp.value = nextScoped
  }

  await withServerLoading(serverId, async () => {
    try {
      await saveScopedConfig(tab, nextScoped, rootPath)

      if (enabled) {
        await startServer(serverId, nextConfig, { quiet: true, manageLoading: false })
      } else {
        await stopServer(serverId, { quiet: true, manageLoading: false })
      }
      await refreshStates()
    } catch (error) {
      if (tab === 'personal') {
        personalMcp.value = scoped
      } else {
        projectMcp.value = scoped
      }
      throw error
    }
  })
}
