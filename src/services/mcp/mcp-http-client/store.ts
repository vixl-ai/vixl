import type {
  ElicitResult,
  ElicitationRequest,
  MCPClient,
  OAuthClientProvider,
} from '@ai-sdk/mcp'
import { UnauthorizedError } from '@ai-sdk/mcp'
import type { McpHttpServer } from '@/types/vixl/mcp-config'
import parseMcpIcons from '@/services/mcp/parse-mcp-icons'
import type { McpServerState, McpToolInfo } from '@/services/vixl/vixl-tauri'
import type { McpIcon } from '@/types/mcp/mcp-icon'
import type { WwwAuthenticateChallenge } from '@/types/mcp/www-authenticate-challenge'
import { getLastOAuthChallenge } from '@/services/mcp/oauth/last-challenge'

type McpElicitationHandler = (
  request: ElicitationRequest,
) => Promise<ElicitResult> | ElicitResult

let elicitationHandler: McpElicitationHandler | null = null

export const setMcpElicitationHandler = (
  handler: McpElicitationHandler | null,
): McpElicitationHandler | null => {
  const previous = elicitationHandler
  elicitationHandler = handler
  return previous
}

export const getMcpElicitationHandler = (): McpElicitationHandler | null =>
  elicitationHandler

export type HttpServerEntry = {
  client: MCPClient | null
  state: McpServerState
  config: McpHttpServer
  authProvider?: OAuthClientProvider
  sessionId?: string | null
  lastChallenge?: WwwAuthenticateChallenge
  lastRequestedScope?: string
}

export const httpServers = new Map<string, HttpServerEntry>()

export const toToolInfo = (tool: {
  name: string
  description?: string
  inputSchema?: unknown
  _meta?: Record<string, unknown>
}): McpToolInfo => ({
  name: tool.name,
  description: tool.description ?? null,
  inputSchema:
    tool.inputSchema && typeof tool.inputSchema === 'object'
      ? (tool.inputSchema as Record<string, unknown>)
      : null,
  meta: tool._meta ?? null,
})

export const iconsFromClient = (client: MCPClient): McpIcon[] | null =>
  parseMcpIcons((client.serverInfo as { icons?: unknown }).icons)

export const setEntryState = (
  serverId: string,
  patch: Partial<McpServerState> & Pick<McpServerState, 'status'>,
  extras?: Partial<
    Pick<
      HttpServerEntry,
      | 'client'
      | 'config'
      | 'authProvider'
      | 'sessionId'
      | 'lastChallenge'
      | 'lastRequestedScope'
    >
  >,
): McpServerState => {
  const existing = httpServers.get(serverId)
  const state: McpServerState = {
    serverId,
    status: patch.status,
    error: patch.error ?? null,
    tools: patch.tools ?? existing?.state.tools ?? [],
    icons:
      patch.icons !== undefined ? patch.icons : (existing?.state.icons ?? null),
  }
  httpServers.set(serverId, {
    client: extras?.client !== undefined ? extras.client : (existing?.client ?? null),
    config: extras?.config ?? existing?.config ?? { type: 'http', url: '' },
    authProvider:
      extras?.authProvider !== undefined
        ? extras.authProvider
        : existing?.authProvider,
    sessionId:
      extras?.sessionId !== undefined
        ? extras.sessionId
        : (existing?.sessionId ?? null),
    lastChallenge:
      extras?.lastChallenge !== undefined
        ? extras.lastChallenge
        : existing?.lastChallenge,
    lastRequestedScope:
      extras?.lastRequestedScope !== undefined
        ? extras.lastRequestedScope
        : existing?.lastRequestedScope,
    state,
  })
  return state
}

export const syncHttpChallengeFromFetch = (serverId: string): void => {
  const existing = httpServers.get(serverId)
  if (!existing?.config.url) {
    return
  }
  const challenge = getLastOAuthChallenge(existing.config.url)
  if (!challenge) {
    return
  }
  httpServers.set(serverId, {
    ...existing,
    lastChallenge: challenge,
  })
}

export const getHttpOauthChallenge = (
  serverId: string,
): WwwAuthenticateChallenge | undefined => {
  const existing = httpServers.get(serverId)
  if (existing?.lastChallenge) {
    return existing.lastChallenge
  }
  if (!existing?.config.url) {
    return undefined
  }
  return getLastOAuthChallenge(existing.config.url)
}

export const setHttpLastRequestedScope = (
  serverId: string,
  scope: string | undefined,
): void => {
  const existing = httpServers.get(serverId)
  if (!existing) {
    return
  }
  httpServers.set(serverId, {
    ...existing,
    lastRequestedScope: scope,
  })
}

export const getHttpLastRequestedScope = (
  serverId: string,
): string | undefined => httpServers.get(serverId)?.lastRequestedScope

export const getHttpServerConfig = (
  serverId: string,
): McpHttpServer | undefined => httpServers.get(serverId)?.config

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof UnauthorizedError ||
  (error instanceof Error &&
    (error.name === 'UnauthorizedError' ||
      /401|unauthorized/i.test(error.message)))
