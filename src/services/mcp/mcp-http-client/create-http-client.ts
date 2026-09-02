import {
  createMCPClient,
  ElicitationRequestSchema,
  type OAuthClientProvider,
} from '@ai-sdk/mcp'
import type { McpHttpServer } from '@/types/vixl/mcp-config'
import { mcpOAuthFetch } from '@/services/mcp/mcp-oauth-fetch'
import { getMcpElicitationHandler } from './store'

type HttpSessionCallbacks = {
  terminateSessionOnClose: true
  onSessionIdChange: (sessionId: string | undefined) => void
  onSessionExpired: (sessionId: string) => void
}

export const createHttpMcpClient = async (
  config: McpHttpServer,
  options?: {
    authProvider?: OAuthClientProvider
    session?: HttpSessionCallbacks
  },
) => {
  const shared = {
    url: config.url,
    headers: config.headers,
    authProvider: options?.authProvider,
    redirect: 'error' as const,
    fetch: mcpOAuthFetch,
  }

  const client = await createMCPClient({
    transport:
      config.type === 'http'
        ? {
            type: 'http',
            ...shared,
            terminateSessionOnClose: true,
            ...options?.session,
          }
        : {
            type: 'sse',
            ...shared,
          },
    maxRetries: 0,
    clientName: 'Vixl',
    capabilities: {
      elicitation: {},
    },
  })

  client.onElicitationRequest(ElicitationRequestSchema, async (request) => {
    const handler = getMcpElicitationHandler()
    if (!handler) {
      return { action: 'cancel' }
    }
    return handler(request)
  })

  return client
}
