import type { MCPClient, OAuthClientProvider } from '@ai-sdk/mcp'
import type { McpHttpServer } from '@/types/vixl/mcp-config'
import type { McpServerState } from '@/services/vixl/vixl-tauri'
import { iconsFromClient, setEntryState, toToolInfo } from './store'

export const applyHttpClientTools = async (
  serverId: string,
  client: MCPClient,
  extras: {
    config: McpHttpServer
    authProvider?: OAuthClientProvider
  },
): Promise<McpServerState> => {
  const listed = await client.listTools()
  const tools = listed.tools.map(toToolInfo)
  const icons = iconsFromClient(client)

  return setEntryState(
    serverId,
    { status: 'connected', tools, icons, error: null },
    { client, config: extras.config, authProvider: extras.authProvider },
  )
}
