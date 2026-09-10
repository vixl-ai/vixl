import { toast } from 'vue-sonner'
import formatUnknownError from '@/utils/format-unknown-error'
import type { McpConfig, McpServerConfig } from '@/types/vixl/mcp-config'
import type { McpInputDefinition } from '@/types/vixl/mcp-config'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { listRequiredInputIdsForServer } from '@/services/mcp/resolve-mcp-inputs'
import { mcpKnownSecretKeys } from '@/services/mcp/mcp-keychain-keys'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import { clearSessionTrust } from '@/services/mcp/mcp-trust'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'
import { deleteSecret, setMcpServerEnabled } from '@/services/vixl/vixl-tauri'
import type { SettingsTab } from '@/composables/use-vixl-config'
import { withServerLoading } from './helpers'
import { saveScopedConfig, refreshStates } from './config'
import { personalMcp, projectMcp } from './state'
import { createStartServer, stopServer } from './lifecycle'

type AssertTrustedFn = (
  serverId: string,
  serverConfig: McpServerConfig,
  settings?: VixlSettings,
  scopeKey?: string | null,
) => void

type StartServerFn = ReturnType<typeof createStartServer>

const scopeKeyFor = (tab: SettingsTab, rootPath: string | null): string =>
  tab === 'personal' ? 'personal' : (rootPath?.trim() || 'personal')

const removeMcpSecrets = async (keys: string[]): Promise<void> => {
  const failures: string[] = []
  for (const key of keys) {
    try {
      await deleteSecret(key)
    } catch (error) {
      failures.push(formatUnknownError(error))
    }
  }
  if (failures.length === 0) {
    return
  }
  toast.error('Failed to remove MCP secret', {
    description: failures.join(', '),
  })
}

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
  await refreshStates(scopeKeyFor(tab, rootPath))
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
  const secretKeys = new Set<string>()
  const scopeKey = scopeKeyFor(tab, rootPath)

  if (previousId && previousId !== serverId) {
    delete nextServers[previousId]
    await mcpRuntime.stop(previousId, undefined, scopeKey)
    const previous = scoped.servers[previousId]
    if (previous) {
      for (const key of mcpKnownSecretKeys(
        previousId,
        listRequiredInputIdsForServer(previous),
      )) {
        secretKeys.add(key)
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
      secretKeys.add(key)
    }
    clearSessionTrust(serverId, scopeKey)
    if (previousId) {
      clearSessionTrust(previousId, scopeKey)
    }
  }

  await removeMcpSecrets([...secretKeys])

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
  await refreshStates(scopeKey)
}

export const deleteServer = async (
  tab: SettingsTab,
  serverId: string,
  rootPath: string | null,
): Promise<void> => {
  const scoped = tab === 'personal' ? personalMcp.value : projectMcp.value
  const removed = scoped.servers[serverId]
  const { [serverId]: _removed, ...rest } = scoped.servers
  const scopeKey = scopeKeyFor(tab, rootPath)
  await saveScopedConfig(tab, { servers: rest }, rootPath)
  await mcpRuntime.stop(serverId, removed, scopeKey)
  if (removed) {
    await removeMcpSecrets(
      mcpKnownSecretKeys(serverId, listRequiredInputIdsForServer(removed)),
    )
  }
  await refreshStates(scopeKey)
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
  tab: SettingsTab,
  rootPath: string | null,
  projectConfigOverride?: McpConfig,
  settings?: VixlSettings,
): Promise<McpConfig | undefined> => {
  const scopeKey = scopeKeyFor(tab, rootPath)
  const projectConfig = projectConfigOverride ?? projectMcp.value
  const scoped = tab === 'personal' ? personalMcp.value : projectConfig
  const existing = scoped.servers[serverId]
  if (!existing) {
    toast.error('MCP server config missing', {
      description: `${serverId} (${tab})`,
    })
    return
  }

  if (enabled) {
    assertTrustedOrThrow(serverId, existing, settings, scopeKey)
  }

  if (tab === 'project' && !rootPath) {
    toast.error('Select a project to update this MCP server')
    return
  }

  const nextConfig: McpServerConfig = { ...existing, enabled }
  const nextScoped: McpConfig = {
    ...scoped,
    servers: {
      ...scoped.servers,
      [serverId]: nextConfig,
    },
  }

  const useProjectOverride = tab === 'project' && projectConfigOverride !== undefined

  if (tab === 'personal') {
    personalMcp.value = nextScoped
  } else if (!useProjectOverride) {
    projectMcp.value = nextScoped
  }

  await withServerLoading(serverId, async () => {
    try {
      await setMcpServerEnabled(tab, serverId, enabled, rootPath)

      if (enabled) {
        await startServer(serverId, nextConfig, {
          quiet: true,
          manageLoading: false,
          scopeKey,
          ...(settings !== undefined ? { settings } : {}),
        })
      } else {
        await stopServer(serverId, { quiet: true, manageLoading: false, scopeKey })
      }
      await refreshStates(scopeKey)
    } catch (error) {
      if (tab === 'personal') {
        personalMcp.value = scoped
      } else if (!useProjectOverride) {
        projectMcp.value = scoped
      }
      throw error
    }
  }, scopeKey)

  if (useProjectOverride) {
    return nextScoped
  }
}
