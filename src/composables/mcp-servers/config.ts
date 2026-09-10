import { toast } from 'vue-sonner'
import type { McpConfig } from '@/types/vixl/mcp-config'
import { parseMcpConfig } from '@/schemas/mcp-config'
import stripCodegraphMcpServer from '@/services/codegraph/strip-codegraph-mcp-server'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import connectionKey from '@/services/mcp/connection-key'
import { isInternalMcpServer, CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import {
  readMcpConfig,
  writeMcpConfig,
  type McpServerState,
} from '@/services/vixl/vixl-tauri'
import type { SettingsTab } from '@/composables/use-vixl-config'
import { mergeServerState, parseConnectionKey } from './helpers'
import {
  bumpRefreshGeneration,
  personalMcp,
  projectMcp,
  refreshGeneration,
  serverStates,
} from './state'

const loadScopedConfig = async (
  scope: 'personal' | 'project',
  rootPath: string | null,
): Promise<{ config: McpConfig; hadCodegraph: boolean }> => {
  const raw = await readMcpConfig(scope, rootPath)
  const parsed = parseMcpConfig(raw)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  const hadCodegraph = CODEGRAPH_SERVER_ID in parsed.config.servers
  return {
    config: stripCodegraphMcpServer(parsed.config),
    hadCodegraph,
  }
}

export const loadPersonalMcpConfig = async (): Promise<McpConfig> => {
  const loaded = await loadScopedConfig('personal', null)
  return loaded.config
}

export const loadProjectConfigForRoot = async (
  rootPath: string,
): Promise<McpConfig> => {
  const loaded = await loadScopedConfig('project', rootPath)
  return loaded.config
}

export const loadConfigs = async (rootPath: string | null): Promise<void> => {
  const personalLoaded = await loadScopedConfig('personal', null)

  let project: McpConfig = { servers: {} }
  let projectHadCodegraph = false
  if (rootPath) {
    const projectLoaded = await loadScopedConfig('project', rootPath)
    project = projectLoaded.config
    projectHadCodegraph = projectLoaded.hadCodegraph
  }

  personalMcp.value = personalLoaded.config
  projectMcp.value = project
  if (personalLoaded.hadCodegraph) {
    await writeMcpConfig('personal', personalLoaded.config, null)
  }
  if (rootPath && projectHadCodegraph) {
    await writeMcpConfig('project', project, rootPath)
  }
}

export const saveScopedConfig = async (
  tab: SettingsTab,
  config: McpConfig,
  rootPath: string | null,
): Promise<void> => {
  const scope = tab === 'personal' ? 'personal' : 'project'
  const cleaned = stripCodegraphMcpServer(config)
  await writeMcpConfig(scope, cleaned, rootPath)
  if (scope === 'personal') {
    personalMcp.value = cleaned
  } else {
    projectMcp.value = cleaned
  }
}

export const refreshStates = async (scopeKey?: string | null): Promise<void> => {
  const generation = bumpRefreshGeneration()
  const resolvedScope = scopeKey?.trim() || 'personal'

  let scopedIds: string[]
  try {
    if (resolvedScope === 'personal') {
      scopedIds = Object.keys(personalMcp.value.servers)
    } else {
      const projectConfig = await loadProjectConfigForRoot(resolvedScope)
      if (generation !== refreshGeneration) {
        return
      }
      scopedIds = Object.keys(projectConfig.servers)
    }
  } catch (error) {
    if (generation !== refreshGeneration) {
      return
    }
    toast.error('Failed to refresh MCP server status', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
    return
  }

  const previousIds = new Set(Object.keys(serverStates.value))

  let bulkStatuses: Record<string, McpServerState> = {}
  try {
    bulkStatuses = await mcpRuntime.listStatuses(resolvedScope)
  } catch (error) {
    if (generation !== refreshGeneration) {
      return
    }
    toast.error('Failed to refresh MCP server status', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
    return
  }

  if (generation !== refreshGeneration) {
    return
  }

  const merged: Record<string, McpServerState> = {
    ...serverStates.value,
  }

  for (const [key, state] of Object.entries(bulkStatuses)) {
    const composite = connectionKey(
      (state as McpServerState & { scopeKey?: string }).scopeKey,
      state.serverId,
    )
    const resolvedKey = key.includes('\u001f') ? key : composite
    merged[resolvedKey] = mergeServerState(
      state.serverId,
      state,
      serverStates.value[resolvedKey] ?? serverStates.value[key],
    )
    if (key !== resolvedKey) {
      delete merged[key]
      if (previousIds.delete(key)) {
        previousIds.add(resolvedKey)
      }
    }
  }

  for (const serverId of scopedIds) {
    const key = connectionKey(resolvedScope, serverId)
    previousIds.delete(key)
    if (resolvedScope === 'personal') {
      previousIds.delete(serverId)
    }
    merged[key] = mergeServerState(
      serverId,
      bulkStatuses[key] ?? bulkStatuses[serverId],
      serverStates.value[key] ?? serverStates.value[serverId],
    )
  }

  const codegraphKey = connectionKey(resolvedScope, CODEGRAPH_SERVER_ID)
  if (
    previousIds.has(codegraphKey) ||
    previousIds.has(CODEGRAPH_SERVER_ID) ||
    bulkStatuses[codegraphKey] ||
    bulkStatuses[CODEGRAPH_SERVER_ID] ||
    serverStates.value[codegraphKey] ||
    serverStates.value[CODEGRAPH_SERVER_ID]
  ) {
    previousIds.delete(codegraphKey)
    previousIds.delete(CODEGRAPH_SERVER_ID)
    merged[codegraphKey] = mergeServerState(
      CODEGRAPH_SERVER_ID,
      bulkStatuses[codegraphKey] ?? bulkStatuses[CODEGRAPH_SERVER_ID],
      serverStates.value[codegraphKey] ?? serverStates.value[CODEGRAPH_SERVER_ID],
    )
    delete merged[CODEGRAPH_SERVER_ID]
  }

  if (generation !== refreshGeneration) {
    return
  }

  for (const removedId of previousIds) {
    const parsed = parseConnectionKey(removedId)
    const belongsToScope =
      parsed.scopeKey === resolvedScope ||
      (resolvedScope === 'personal' && !removedId.includes('\u001f'))
    if (!belongsToScope) {
      continue
    }
    if (isInternalMcpServer(parsed.serverId)) {
      continue
    }
    try {
      await mcpRuntime.stop(parsed.serverId, undefined, parsed.scopeKey)
    } catch (error) {
      toast.error('Failed to stop MCP server', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
    if (generation !== refreshGeneration) {
      return
    }
    delete merged[removedId]
  }

  if (generation !== refreshGeneration) {
    return
  }

  serverStates.value = merged
}
