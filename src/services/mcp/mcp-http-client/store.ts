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
  extras?: Partial<Pick<HttpServerEntry, 'client' | 'config' | 'authProvider'>>,
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
    state,
  })
  return state
}

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof UnauthorizedError ||
  (error instanceof Error &&
    (error.name === 'UnauthorizedError' ||
      /401|unauthorized/i.test(error.message)))
