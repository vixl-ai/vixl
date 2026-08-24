import type { McpServerState } from '@/services/vixl/vixl-tauri'
import { loadingServers, serverStates } from './state'

export const isActiveStatus = (status: string): boolean =>
  status === 'connected' || status === 'starting' || status === 'refreshing'

export const setServerLoading = (serverId: string, loading: boolean): void => {
  loadingServers.value = {
    ...loadingServers.value,
    [serverId]: loading,
  }
}

export const withServerLoading = async (
  serverId: string,
  action: () => Promise<void>,
): Promise<void> => {
  setServerLoading(serverId, true)
  try {
    await action()
  } finally {
    setServerLoading(serverId, false)
  }
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

export const patchServerState = (serverId: string, state: McpServerState): void => {
  serverStates.value = {
    ...serverStates.value,
    [serverId]: state,
  }
}
