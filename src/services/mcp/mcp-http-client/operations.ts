import type { McpServerState } from '@/services/vixl/vixl-tauri'
import { httpServers, isUnauthorized, setEntryState } from './store'

export const listHttpResources = async (serverId: string): Promise<unknown> => {
  const entry = httpServers.get(serverId)
  if (!entry?.client) {
    throw new Error('Server not running')
  }
  return entry.client.listResources()
}

export const readHttpResource = async (
  serverId: string,
  uri: string,
): Promise<unknown> => {
  const entry = httpServers.get(serverId)
  if (!entry?.client) {
    throw new Error('Server not running')
  }
  return entry.client.readResource({ uri })
}

export const listHttpPrompts = async (serverId: string): Promise<unknown> => {
  const entry = httpServers.get(serverId)
  if (!entry?.client) {
    throw new Error('Server not running')
  }
  return entry.client.experimental_listPrompts()
}

export const getHttpPrompt = async (
  serverId: string,
  name: string,
  promptArgs?: Record<string, unknown>,
): Promise<unknown> => {
  const entry = httpServers.get(serverId)
  if (!entry?.client) {
    throw new Error('Server not running')
  }
  return entry.client.experimental_getPrompt({
    name,
    arguments: promptArgs,
  })
}

export const callHttpTool = async (
  serverId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const entry = httpServers.get(serverId)
  if (!entry?.client) {
    throw new Error('Server not running')
  }

  try {
    return await entry.client.callTool({
      name,
      arguments: args,
    })
  } catch (error) {
    if (isUnauthorized(error)) {
      setEntryState(serverId, {
        status: 'auth_required',
        tools: entry.state.tools,
        error: error instanceof Error ? error.message : 'Authentication required',
      })
    }
    throw error
  }
}

export const getHttpState = (serverId: string): McpServerState | undefined =>
  httpServers.get(serverId)?.state

export const listHttpStates = (): Record<string, McpServerState> => {
  const states: Record<string, McpServerState> = {}
  for (const [id, entry] of httpServers) {
    states[id] = entry.state
  }
  return states
}

export const hasHttpServer = (serverId: string): boolean =>
  httpServers.has(serverId)
