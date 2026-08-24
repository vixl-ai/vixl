import { call } from './helpers'
import type { HttpProxyRequest, McpServerState, OAuthLoopbackStart } from './types'

export const openExternalUrl = (
  url: string,
  allowedOrigin: string,
): Promise<void> => call('open_external_url', { url, allowedOrigin })

export const oauthBeginLoopback = (): Promise<OAuthLoopbackStart> =>
  call('oauth_begin_loopback')

export const oauthCancelLoopback = (): Promise<void> => call('oauth_cancel_loopback')

export const mcpStart = (
  serverId: string,
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<McpServerState> =>
  call('mcp_start', { serverId, command, args, env: env ?? null })

export const mcpStop = (serverId: string): Promise<void> => call('mcp_stop', { serverId })

export const mcpRefresh = (serverId: string): Promise<McpServerState> =>
  call('mcp_refresh', { serverId })

export const mcpLogout = (serverId: string): Promise<void> => call('mcp_logout', { serverId })

export const mcpStatus = (serverId: string): Promise<McpServerState> =>
  call('mcp_status', { serverId })

export const mcpListStatuses = (): Promise<Record<string, McpServerState>> =>
  call('mcp_list_statuses')

export const httpProxyRequest = (
  request: HttpProxyRequest,
): Promise<{ status: number; body: string; headers: Record<string, string> }> =>
  call('http_proxy_request', { request })

export const mcpCallTool = (
  serverId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> => call('mcp_call_tool', { serverId, tool, args })
