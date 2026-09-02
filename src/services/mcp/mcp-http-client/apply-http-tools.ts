import type { MCPClient, OAuthClientProvider } from '@ai-sdk/mcp'
import type { McpHttpServer } from '@/types/vixl/mcp-config'
import {
  detectMcpToolDrift,
  loadMcpToolBaseline,
  saveMcpToolBaseline,
} from '@/services/mcp/mcp-tool-baseline'
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
  const fingerprintSources = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
  const baseline = await loadMcpToolBaseline(serverId)
  if (baseline) {
    const drift = await detectMcpToolDrift(serverId, fingerprintSources)
    if (drift.drifted) {
      await client.close()
      return setEntryState(
        serverId,
        {
          status: 'error',
          tools,
          icons,
          error: `Tool definitions changed (${[...drift.changed, ...drift.added].join(', ') || 'unknown'}). Re-trust this server in Settings.`,
        },
        {
          client: null,
          config: extras.config,
          authProvider: extras.authProvider,
          sessionId: null,
        },
      )
    }
  } else {
    await saveMcpToolBaseline(serverId, fingerprintSources)
  }

  return setEntryState(
    serverId,
    { status: 'connected', tools, icons, error: null },
    { client, config: extras.config, authProvider: extras.authProvider },
  )
}
