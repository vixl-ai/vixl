import { migrateMcpConfig, isMcpServerEnabled } from '@/schemas/mcp-config'
import { listUserMcpServers } from '@/services/mcp/merge-mcp-config'
import { mcpListStatuses, readMcpConfig } from '@/services/vixl/vixl-tauri'

export default async (
  projectRoot: string,
  standalone?: boolean,
): Promise<string> => {
  const personal = migrateMcpConfig(await readMcpConfig('personal', null))
  const project =
    standalone
      ? null
      : await readMcpConfig('project', projectRoot)
          .then((raw) => migrateMcpConfig(raw))
          .catch(() => null)
  const servers = listUserMcpServers(personal, project).filter((server) =>
    isMcpServerEnabled(server.config),
  )

  if (servers.length === 0) {
    return ''
  }

  let bulkStatuses: Awaited<ReturnType<typeof mcpListStatuses>> = {}
  try {
    bulkStatuses = await mcpListStatuses()
  } catch {
    bulkStatuses = {}
  }

  const lines: string[] = []
  for (const server of servers) {
    const state = bulkStatuses[server.id]
    if (!state) {
      lines.push(`- ${server.id}: not running — start in Settings or call get_mcp_tools`)
      continue
    }
    if (state.tools.length === 0) {
      lines.push(
        `- ${server.id} (${state.status}): no tools listed — start the server in Settings or call get_mcp_tools`,
      )
      continue
    }
    const toolLines = state.tools
      .map(
        (tool) =>
          `  - ${tool.name}${
            tool.description
              ? `: ${
                  tool.description.length > 200
                    ? `${tool.description.slice(0, 200)}...`
                    : tool.description
                }`
              : ''
          }`,
      )
      .join('\n')
    lines.push(`- ${server.id} (${state.status}):\n${toolLines}`)
  }

  return lines.join('\n')
}
