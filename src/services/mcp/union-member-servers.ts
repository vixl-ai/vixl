import { isMcpServerEnabled, migrateMcpConfig } from '@/schemas/mcp-config'
import { listUserMcpServers, type EffectiveMcpServer } from '@/services/mcp/merge-mcp-config'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { McpConfig, McpServerConfig, McpServerScope } from '@/types/vixl/mcp-config'
import { readMcpConfig } from '@/services/vixl/vixl-tauri'
import { hasGroupMembers, parseMemberQualifiedName } from '@/utils/parse-member-qualified-name'

export type UnionedMcpServer = {
  id: string
  displayId: string
  scope: McpServerScope
  scopeKey: string
  config: McpServerConfig
  memberSlug?: string
}

const readProjectMcpConfig = async (projectRoot: string): Promise<McpConfig | null> => {
  try {
    return migrateMcpConfig(await readMcpConfig('project', projectRoot))
  } catch {
    return null
  }
}

const fromSingleRoot = (
  servers: EffectiveMcpServer[],
  projectRoot: string,
): UnionedMcpServer[] =>
  servers.map((server) => ({
    id: server.id,
    displayId: server.id,
    scope: server.scope,
    scopeKey: server.scope === 'personal' ? 'personal' : projectRoot,
    config: server.config,
  }))

const qualifyProjectDisplayId = (
  serverId: string,
  memberSlug: string,
  memberIdCounts: Map<string, number>,
  personalIds: Set<string>,
): string => {
  if ((memberIdCounts.get(serverId) ?? 0) > 1 || personalIds.has(serverId)) {
    return `${memberSlug}:${serverId}`
  }
  return serverId
}

const listGroupServers = async (
  members: HarnessWorkspaceMember[],
  personal: McpConfig,
): Promise<UnionedMcpServer[]> => {
  const personalIds = new Set(
    Object.keys(personal.servers).filter((id) => !isInternalMcpServer(id)),
  )
  const personalServers: UnionedMcpServer[] = [...personalIds].map((id) => ({
    id,
    displayId: id,
    scope: 'personal' as const,
    scopeKey: 'personal',
    config: personal.servers[id]!,
  }))

  const memberConfigs = await Promise.all(
    members.map(async (member) => ({
      member,
      config: await readProjectMcpConfig(member.rootPath),
    })),
  )

  const memberIdCounts = new Map<string, number>()
  const projectServers: Array<{ member: HarnessWorkspaceMember; id: string; config: McpServerConfig }> =
    []
  for (const { member, config } of memberConfigs) {
    if (!config) {
      continue
    }
    for (const [id, serverConfig] of Object.entries(config.servers)) {
      if (isInternalMcpServer(id)) {
        continue
      }
      memberIdCounts.set(id, (memberIdCounts.get(id) ?? 0) + 1)
      projectServers.push({ member, id, config: serverConfig })
    }
  }

  const listed: UnionedMcpServer[] = [
    ...personalServers,
    ...projectServers.map(({ member, id, config }) => ({
      id,
      displayId: qualifyProjectDisplayId(id, member.slug, memberIdCounts, personalIds),
      scope: (personalIds.has(id) ? 'overridden' : 'project') as McpServerScope,
      scopeKey: member.rootPath,
      config,
      memberSlug: member.slug,
    })),
  ]
  return listed
}

export const listUnionedMcpServers = async (
  projectRoot: string,
  members: HarnessWorkspaceMember[] | undefined,
  standalone?: boolean,
): Promise<UnionedMcpServer[]> => {
  const personal = migrateMcpConfig(await readMcpConfig('personal', null))
  if (standalone || !hasGroupMembers(members)) {
    const project = standalone ? null : await readProjectMcpConfig(projectRoot)
    return fromSingleRoot(listUserMcpServers(personal, project), projectRoot)
  }
  return listGroupServers(members, personal)
}

export const missingMcpServerError = (serverId: string): string =>
  `MCP server "${serverId}" was not found in any mcp.json config.`

export const ambiguousMcpServerError = (serverId: string, hits: UnionedMcpServer[]): string =>
  `MCP server "${serverId}" is defined in multiple projects. Use one of: ${hits
    .map((hit) => hit.displayId)
    .join(', ')}`

export const resolveUnionedMcpServer = (
  servers: UnionedMcpServer[],
  requestedId: string,
  members: HarnessWorkspaceMember[] | undefined,
): UnionedMcpServer | { error: string } => {
  const qualified = parseMemberQualifiedName(requestedId, members)
  if (qualified) {
    const found = servers.find(
      (server) => server.memberSlug === qualified.member.slug && server.id === qualified.name,
    )
    if (!found) {
      return { error: missingMcpServerError(requestedId) }
    }
    return found
  }

  if (hasGroupMembers(members)) {
    const memberHits = servers.filter(
      (server) => server.memberSlug && server.id === requestedId,
    )
    if (memberHits.length > 1) {
      return { error: ambiguousMcpServerError(requestedId, memberHits) }
    }
  }

  const exactDisplay = servers.find((server) => server.displayId === requestedId)
  if (exactDisplay) {
    return exactDisplay
  }

  const byId = servers.filter((server) => server.id === requestedId)
  if (byId.length === 1) {
    return byId[0]!
  }
  if (byId.length > 1) {
    return { error: ambiguousMcpServerError(requestedId, byId) }
  }
  return { error: missingMcpServerError(requestedId) }
}

export const isEnabledUnionedServer = (server: UnionedMcpServer): boolean =>
  isMcpServerEnabled(server.config)
