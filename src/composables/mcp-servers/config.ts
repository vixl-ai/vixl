import { toast } from 'vue-sonner'
import type { McpConfig } from '@/types/vixl/mcp-config'
import { migrateMcpConfig } from '@/schemas/mcp-config'
import stripCodegraphMcpServer from '@/services/codegraph/strip-codegraph-mcp-server'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { isInternalMcpServer, CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import { listEffectiveMcpServers } from '@/services/mcp/merge-mcp-config'
import {
  readMcpConfig,
  writeMcpConfig,
  type McpServerState,
} from '@/services/vixl/vixl-tauri'
import type { SettingsTab } from '@/composables/use-vixl-config'
import { mergeServerState } from './helpers'
import {
  bumpRefreshGeneration,
  personalMcp,
  projectMcp,
  refreshGeneration,
  serverStates,
} from './state'

export const loadConfigs = async (rootPath: string | null): Promise<void> => {
  const personalRaw = await readMcpConfig('personal')
  const personalMigrated = migrateMcpConfig(personalRaw)
  const personalHadCodegraph = CODEGRAPH_SERVER_ID in personalMigrated.servers
  const personal = stripCodegraphMcpServer(personalMigrated)
  personalMcp.value = personal
  if (personalHadCodegraph) {
    await writeMcpConfig('personal', personal, null)
  }

  if (rootPath) {
    const projectRaw = await readMcpConfig('project', rootPath)
    const projectMigrated = migrateMcpConfig(projectRaw)
    const projectHadCodegraph = CODEGRAPH_SERVER_ID in projectMigrated.servers
    const project = stripCodegraphMcpServer(projectMigrated)
    projectMcp.value = project
    if (projectHadCodegraph) {
      await writeMcpConfig('project', project, rootPath)
    }
  } else {
    projectMcp.value = { servers: {} }
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

export const refreshStates = async (): Promise<void> => {
  const generation = bumpRefreshGeneration()
  const effective = listEffectiveMcpServers(personalMcp.value, projectMcp.value)
  const previousIds = new Set(Object.keys(serverStates.value))

  let bulkStatuses: Record<string, McpServerState> = {}
  try {
    bulkStatuses = await mcpRuntime.listStatuses()
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

  for (const server of effective) {
    previousIds.delete(server.id)
    merged[server.id] = mergeServerState(
      server.id,
      bulkStatuses[server.id],
      serverStates.value[server.id],
    )
  }

  // Internal CodeGraph is runtime-only (not in user MCP JSON). Keep its state.
  if (
    previousIds.has(CODEGRAPH_SERVER_ID) ||
    bulkStatuses[CODEGRAPH_SERVER_ID] ||
    serverStates.value[CODEGRAPH_SERVER_ID]
  ) {
    previousIds.delete(CODEGRAPH_SERVER_ID)
    merged[CODEGRAPH_SERVER_ID] = mergeServerState(
      CODEGRAPH_SERVER_ID,
      bulkStatuses[CODEGRAPH_SERVER_ID],
      serverStates.value[CODEGRAPH_SERVER_ID],
    )
  }

  if (generation !== refreshGeneration) {
    return
  }

  for (const removedId of previousIds) {
    if (isInternalMcpServer(removedId)) {
      continue
    }
    try {
      await mcpRuntime.stop(removedId)
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
