import type { SettingsTab } from '@/composables/use-vixl-config'
import type { EffectiveMcpServer } from '@/services/mcp/merge-mcp-config'
import type { UnionedMcpServer } from '@/services/mcp/union-member-servers'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

export const mcpPickerMemberSetKey = (
  members: HarnessWorkspaceMember[] | undefined,
): string =>
  (members ?? [])
    .map((member) => `${member.slug}=${member.rootPath}`)
    .join('\n')

export const isMemberOwnedMcpPickerServer = (server: UnionedMcpServer): boolean =>
  Boolean(
    server.memberSlug
    && server.scopeKey.trim()
    && server.scopeKey !== 'personal',
  )

export const unionMcpPickerProjectScopeKeys = (rows: UnionedMcpServer[]): string[] => {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const key = row.scopeKey.trim()
    if (!key || key === 'personal' || seen.has(key)) {
      continue
    }
    seen.add(key)
    keys.push(key)
  }
  return keys
}

export const toSingleRootMcpPickerServer = (
  server: EffectiveMcpServer,
  projectRoot: string | null,
): UnionedMcpServer => ({
  id: server.id,
  displayId: server.id,
  scope: server.scope,
  scopeKey: server.scope === 'personal'
    ? 'personal'
    : (projectRoot?.trim() || 'personal'),
  config: server.config,
})

export const mcpPickerServerMatchesQuery = (
  server: UnionedMcpServer,
  query: string,
): boolean => {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return true
  }
  if (server.id.toLowerCase().includes(needle)) {
    return true
  }
  if (server.displayId.toLowerCase().includes(needle)) {
    return true
  }
  return Boolean(server.memberSlug?.toLowerCase().includes(needle))
}

export const mcpPickerSettingsTab = (server: UnionedMcpServer): SettingsTab =>
  server.scope === 'personal' ? 'personal' : 'project'

export const mcpPickerShowSettings = (
  server: UnionedMcpServer,
  fleetRoot: string | null | undefined,
): boolean => {
  if (!isMemberOwnedMcpPickerServer(server)) {
    return true
  }
  return server.scopeKey.trim() === (fleetRoot?.trim() ?? '')
}

export const patchUnionMcpPickerRow = (
  rows: UnionedMcpServer[],
  server: UnionedMcpServer,
  checked: boolean,
): UnionedMcpServer[] => {
  const index = rows.findIndex(
    (row) => row.id === server.id && row.scopeKey === server.scopeKey,
  )
  const match = index === -1 ? undefined : rows[index]
  if (index === -1 || !match) {
    return rows
  }
  const next = [...rows]
  next[index] = {
    ...match,
    config: {
      ...match.config,
      enabled: checked,
    },
  }
  return next
}
