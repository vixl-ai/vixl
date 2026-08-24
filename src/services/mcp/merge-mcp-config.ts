import type {
  McpConfig,
  McpInputDefinition,
  McpServerConfig,
  McpServerScope,
} from '@/types/vixl/mcp-config'
import { defaultMcpConfig } from '@/schemas/mcp-config'
import { isInternalMcpServer } from '@/types/codegraph/managed-codegraph'

export type EffectiveMcpServer = {
  id: string
  config: McpServerConfig
  scope: McpServerScope
}

const mergeInputs = (
  personal: McpInputDefinition[] | undefined,
  project: McpInputDefinition[] | undefined,
): McpInputDefinition[] | undefined => {
  if (!personal?.length && !project?.length) {
    return undefined
  }

  const byId = new Map<string, McpInputDefinition>()
  for (const input of personal ?? []) {
    byId.set(input.id, input)
  }
  for (const input of project ?? []) {
    byId.set(input.id, input)
  }

  const merged = [...byId.values()]
  return merged.length > 0 ? merged : undefined
}

export const mergeMcpConfig = (
  personal: McpConfig,
  project: McpConfig | null,
): McpConfig => {
  if (!project) {
    return {
      servers: { ...personal.servers },
      ...(personal.inputs ? { inputs: [...personal.inputs] } : {}),
    }
  }

  const inputs = mergeInputs(personal.inputs, project.inputs)

  return {
    servers: {
      ...personal.servers,
      ...project.servers,
    },
    ...(inputs ? { inputs } : {}),
  }
}

export const listEffectiveMcpServers = (
  personal: McpConfig,
  project: McpConfig | null,
): EffectiveMcpServer[] => {
  const personalIds = new Set(Object.keys(personal.servers))
  const projectIds = new Set(Object.keys(project?.servers ?? {}))
  const allIds = new Set([...personalIds, ...projectIds])

  const servers: EffectiveMcpServer[] = []

  for (const id of allIds) {
    const inPersonal = personalIds.has(id)
    const inProject = projectIds.has(id)

    if (inProject) {
      servers.push({
        id,
        config: project!.servers[id]!,
        scope: inPersonal ? 'overridden' : 'project',
      })
      continue
    }

    servers.push({
      id,
      config: personal.servers[id]!,
      scope: 'personal',
    })
  }

  return servers.sort((a, b) => a.id.localeCompare(b.id))
}

/** User-visible MCP servers only (excludes first-party internal entries like CodeGraph). */
export const listUserMcpServers = (
  personal: McpConfig,
  project: McpConfig | null,
): EffectiveMcpServer[] =>
  listEffectiveMcpServers(personal, project).filter(
    (server) => !isInternalMcpServer(server.id),
  )

export const listScopedMcpServers = (
  personal: McpConfig,
  project: McpConfig | null,
  tab: 'personal' | 'project',
): EffectiveMcpServer[] => {
  const personalIds = new Set(Object.keys(personal.servers))

  if (tab === 'personal') {
    return Object.entries(personal.servers)
      .filter(([id]) => !isInternalMcpServer(id))
      .map(([id, config]) => ({
        id,
        config,
        scope: 'personal' as const,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  return Object.entries(project?.servers ?? {})
    .filter(([id]) => !isInternalMcpServer(id))
    .map(([id, config]) => ({
      id,
      config,
      scope: (personalIds.has(id) ? 'overridden' : 'project') as McpServerScope,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export const emptyMcpConfig = (): McpConfig => defaultMcpConfig()
