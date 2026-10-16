import connectionKey from '@/services/mcp/connection-key'
import {
  isEnabledUnionedServer,
  listUnionedMcpServers,
  type UnionedMcpServer,
} from '@/services/mcp/union-member-servers'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { mcpListStatuses } from '@/services/vixl/vixl-tauri'

const MCP_START_HINT = 'start the server in Settings or call get_mcp_tools to check its status'

const listStatusesForScope = async (
  scopeKey?: string,
): Promise<Awaited<ReturnType<typeof mcpListStatuses>>> => {
  try {
    return scopeKey === undefined
      ? await mcpListStatuses()
      : await mcpListStatuses(scopeKey)
  } catch {
    return {}
  }
}

const formatToolDescription = (description: string): string =>
  description.length > 200 ? `${description.slice(0, 200)}...` : description

const formatServerLine = (
  server: UnionedMcpServer,
  bulkStatuses: Awaited<ReturnType<typeof mcpListStatuses>>,
): string => {
  const state = bulkStatuses[connectionKey(server.scopeKey, server.id)]
  if (!state) {
    return `- ${server.displayId}: not running, ${MCP_START_HINT}`
  }
  if (state.tools.length === 0) {
    return `- ${server.displayId} (${state.status}): no tools listed, ${MCP_START_HINT}`
  }
  const toolLines = state.tools
    .map(
      (tool) =>
        `  - ${tool.name}${
          tool.description ? `: ${formatToolDescription(tool.description)}` : ''
        }`,
    )
    .join('\n')
  return `- ${server.displayId} (${state.status}):\n${toolLines}`
}

export default async (
  projectRoot: string,
  standalone?: boolean,
  members?: HarnessWorkspaceMember[],
): Promise<string> => {
  const servers = (await listUnionedMcpServers(projectRoot, members, standalone)).filter(
    isEnabledUnionedServer,
  )
  if (servers.length === 0) {
    return ''
  }

  const extraScopeKeys = [
    ...new Set(
      servers
        .map((server) => server.scopeKey)
        .filter((scopeKey) => scopeKey !== 'personal'),
    ),
  ]
  const personalStatuses = await listStatusesForScope()
  const projectStatusLists = await Promise.all(
    extraScopeKeys.map(async (scopeKey) => listStatusesForScope(scopeKey)),
  )
  const bulkStatuses = Object.assign({}, personalStatuses, ...projectStatusLists)
  return servers.map((server) => formatServerLine(server, bulkStatuses)).join('\n')
}
