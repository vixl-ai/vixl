import type { McpServerConfig } from '@/types/vixl/mcp-config'
import type { McpServerState } from '@/services/vixl/vixl-tauri'
import { parseMcpConfig } from '@/schemas/mcp-config'
import stripCodegraphMcpServer from '@/services/codegraph/strip-codegraph-mcp-server'
import connectionKey from '@/services/mcp/connection-key'
import { listEffectiveMcpServers } from '@/services/mcp/merge-mcp-config'
import { readMcpConfig } from '@/services/vixl/vixl-tauri'
import { loadingServers, personalMcp, serverStates } from './state'

export const isActiveStatus = (status: string): boolean =>
  status === 'connected' || status === 'starting' || status === 'refreshing'

export const parseConnectionKey = (
  key: string,
): { scopeKey: string; serverId: string } => {
  const separator = '\u001f'
  const index = key.indexOf(separator)
  if (index === -1) {
    return { scopeKey: 'personal', serverId: key }
  }
  return {
    scopeKey: key.slice(0, index) || 'personal',
    serverId: key.slice(index + separator.length),
  }
}

const projectConfigForRoot = async (rootPath: string) => {
  const raw = await readMcpConfig('project', rootPath)
  const parsed = parseMcpConfig(raw)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return stripCodegraphMcpServer(parsed.config)
}

export const resolveEffectiveServerConfig = async (
  serverId: string,
  config?: McpServerConfig,
  scopeKey?: string | null,
): Promise<McpServerConfig | undefined> => {
  if (config) {
    return config
  }
  const resolvedScope = scopeKey?.trim() || 'personal'
  if (resolvedScope === 'personal') {
    return personalMcp.value.servers[serverId]
  }
  const project = await projectConfigForRoot(resolvedScope)
  return listEffectiveMcpServers(personalMcp.value, project).find(
    (server) => server.id === serverId,
  )?.config
}

export const setServerLoading = (
  serverId: string,
  loading: boolean,
  scopeKey?: string | null,
): void => {
  loadingServers.value = {
    ...loadingServers.value,
    [connectionKey(scopeKey, serverId)]: loading,
  }
}

export const withServerLoading = async (
  serverId: string,
  action: () => Promise<void>,
  scopeKey?: string | null,
): Promise<void> => {
  setServerLoading(serverId, true, scopeKey)
  try {
    await action()
  } finally {
    setServerLoading(serverId, false, scopeKey)
  }
}

export const withOptionalServerLoading = async (
  serverId: string,
  manageLoading: boolean | undefined,
  action: () => Promise<void>,
  scopeKey?: string | null,
): Promise<void> => {
  if (manageLoading === false) {
    await action()
    return
  }
  await withServerLoading(serverId, action, scopeKey)
}

export const mergeServerState = (
  serverId: string,
  freshState: McpServerState | undefined,
  existing: McpServerState | undefined,
): McpServerState => {
  if (freshState) {
    return {
      ...freshState,
      icons: freshState.icons ?? existing?.icons ?? null,
    }
  }

  const existingStatus = existing?.status ?? 'stopped'
  if (isActiveStatus(existingStatus)) {
    return existing ?? {
      serverId,
      status: existingStatus,
      tools: [],
      icons: null,
    }
  }

  return {
    serverId,
    status: 'stopped',
    tools: [],
    icons: existing?.icons ?? null,
  }
}

export const patchServerState = (
  serverId: string,
  state: McpServerState,
  scopeKey?: string | null,
): void => {
  const key = connectionKey(scopeKey, serverId)
  serverStates.value = {
    ...serverStates.value,
    [key]: state,
  }
}
