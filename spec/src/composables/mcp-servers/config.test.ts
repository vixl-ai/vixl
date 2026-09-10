import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type { McpServerState } from '@/services/vixl/vixl-tauri'

const { readMcpConfig, writeMcpConfig, mcpStop, mcpListStatuses } = vi.hoisted(() => ({
  readMcpConfig: vi.fn<(scope: string, rootPath?: string | null) => Promise<unknown>>(),
  writeMcpConfig: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  mcpStop: vi.fn<
    (serverId: string, config?: unknown, scopeKey?: string | null) => Promise<void>
  >(async () => undefined),
  mcpListStatuses: vi.fn<
    (scopeKey?: string | null) => Promise<Record<string, McpServerState>>
  >(async () => ({})),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readMcpConfig,
    writeMcpConfig,
  }),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    listStatuses: (scopeKey?: string | null) => mcpListStatuses(scopeKey),
    stop: (serverId: string, config?: unknown, scopeKey?: string | null) =>
      mcpStop(serverId, config, scopeKey),
  },
}))

import {
  loadConfigs,
  loadProjectConfigForRoot,
  refreshStates,
} from '@/composables/mcp-servers/config'
import { personalMcp, projectMcp, serverStates } from '@/composables/mcp-servers/state'
import connectionKey from '@/services/mcp/connection-key'

const braveConfig = {
  servers: {
    brave: { command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'] },
  },
}

const connectedBrave: McpServerState = {
  serverId: 'brave',
  status: 'connected',
  tools: [],
  icons: null,
}

const seedRunningBrave = (): void => {
  personalMcp.value = {
    servers: {
      brave: { command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'] },
    },
  }
  projectMcp.value = { servers: {} }
  serverStates.value = { [connectionKey(undefined, 'brave')]: connectedBrave }
  mcpListStatuses.mockResolvedValue({ brave: connectedBrave })
}

describe('mcp-servers loadConfigs and refreshStates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedRunningBrave()
    readMcpConfig.mockResolvedValue({ servers: {} })
  })

  it('does not stop running servers when mcp.json fails to parse', async () => {
    readMcpConfig.mockResolvedValue({ mcpServers: braveConfig.servers })

    await expect(loadConfigs('/project')).rejects.toThrow(/missing a servers object/)
    expect(personalMcp.value.servers.brave).toBeDefined()

    await refreshStates()

    expect(mcpStop).not.toHaveBeenCalled()
    expect(serverStates.value[connectionKey(undefined, 'brave')]?.status).toBe('connected')
  })

  it('does not stop running servers when the config read fails', async () => {
    readMcpConfig.mockRejectedValue(new Error('disk busy'))

    await expect(loadConfigs('/project')).rejects.toThrow('disk busy')
    expect(personalMcp.value.servers.brave).toBeDefined()

    await refreshStates()

    expect(mcpStop).not.toHaveBeenCalled()
    expect(serverStates.value[connectionKey(undefined, 'brave')]?.status).toBe('connected')
  })

  it('stops a running server that is genuinely absent after a successful load', async () => {
    readMcpConfig.mockResolvedValue({ servers: {} })

    await loadConfigs('/project')
    expect(personalMcp.value.servers).toEqual({})

    await refreshStates()

    expect(mcpStop).toHaveBeenCalledWith('brave', undefined, 'personal')
    expect(serverStates.value[connectionKey(undefined, 'brave')]).toBeUndefined()
  })

  it('does not stop connections that belong to another project root', async () => {
    const otherKey = connectionKey('/other/project', 'github')
    const github: McpServerState = {
      serverId: 'github',
      status: 'connected',
      tools: [],
      icons: null,
    }
    serverStates.value = {
      [connectionKey(undefined, 'brave')]: connectedBrave,
      [otherKey]: github,
    }
    mcpListStatuses.mockResolvedValue({
      [connectionKey(undefined, 'brave')]: connectedBrave,
      [otherKey]: github,
    })
    readMcpConfig.mockResolvedValue({ servers: {} })

    await loadConfigs('/project')
    await refreshStates()

    expect(mcpStop).toHaveBeenCalledWith('brave', undefined, 'personal')
    expect(mcpStop).not.toHaveBeenCalledWith('github', undefined, '/other/project')
    expect(serverStates.value[otherKey]?.status).toBe('connected')
    expect(serverStates.value[connectionKey(undefined, 'brave')]).toBeUndefined()
  })

  it('refreshStates for root A never stops or removes root B or personal connections', async () => {
    const rootA = '/tmp/project-a'
    const rootB = '/tmp/project-b'
    const personalKey = connectionKey('personal', 'brave')
    const keyA = connectionKey(rootA, 'github')
    const keyB = connectionKey(rootB, 'github')
    const githubA: McpServerState = {
      serverId: 'github',
      status: 'connected',
      tools: [{ name: 'search-a' }],
      icons: null,
    }
    const githubB: McpServerState = {
      serverId: 'github',
      status: 'connected',
      tools: [{ name: 'search-b' }],
      icons: null,
    }
    personalMcp.value = {
      servers: {
        brave: { command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'] },
      },
    }
    projectMcp.value = {
      servers: {
        github: { command: 'npx', args: ['-y', 'github-mcp'] },
      },
    }
    serverStates.value = {
      [personalKey]: connectedBrave,
      [keyA]: githubA,
      [keyB]: githubB,
    }
    mcpListStatuses.mockResolvedValue({
      [keyA]: githubA,
    })
    readMcpConfig.mockImplementation(async (scope, rootPath) => {
      if (scope === 'project' && rootPath === rootA) {
        return {
          servers: {
            github: { command: 'npx', args: ['-y', 'github-mcp'] },
          },
        }
      }
      return { servers: {} }
    })

    await refreshStates(rootA)

    expect(mcpStop).not.toHaveBeenCalled()
    expect(serverStates.value[personalKey]).toEqual(connectedBrave)
    expect(serverStates.value[keyB]).toEqual(githubB)
    expect(serverStates.value[keyA]?.status).toBe('connected')
    expect(mcpListStatuses).toHaveBeenCalledWith(rootA)
  })

  it('fetches statuses for the requested project scope and applies them', async () => {
    const root = '/tmp/project-a'
    const key = connectionKey(root, 'github')
    const stale: McpServerState = {
      serverId: 'github',
      status: 'connected',
      tools: [{ name: 'search' }],
      icons: null,
    }
    const fresh: McpServerState = {
      serverId: 'github',
      status: 'stopped',
      tools: [],
      icons: null,
    }
    personalMcp.value = { servers: {} }
    projectMcp.value = {
      servers: {
        github: { command: 'npx', args: ['-y', 'github-mcp'] },
      },
    }
    serverStates.value = { [key]: stale }
    mcpListStatuses.mockResolvedValue({ [key]: fresh })
    readMcpConfig.mockResolvedValue({
      servers: {
        github: { command: 'npx', args: ['-y', 'github-mcp'] },
      },
    })

    await refreshStates(root)

    expect(mcpListStatuses).toHaveBeenCalledWith(root)
    expect(mcpStop).not.toHaveBeenCalled()
    expect(serverStates.value[key]?.status).toBe('stopped')
    expect(serverStates.value[key]?.tools).toEqual([])
  })

  it('does not stop root B servers when refreshing root B while the active root is A', async () => {
    const rootA = '/tmp/project-a'
    const rootB = '/tmp/project-b'
    const keyA = connectionKey(rootA, 'github')
    const keyB = connectionKey(rootB, 'slack')
    const githubA: McpServerState = {
      serverId: 'github',
      status: 'connected',
      tools: [],
      icons: null,
    }
    const slackB: McpServerState = {
      serverId: 'slack',
      status: 'connected',
      tools: [],
      icons: null,
    }
    personalMcp.value = { servers: {} }
    projectMcp.value = {
      servers: {
        github: { command: 'npx', args: ['-y', 'github-mcp'] },
      },
    }
    serverStates.value = {
      [keyA]: githubA,
      [keyB]: slackB,
    }
    mcpListStatuses.mockResolvedValue({ [keyB]: slackB })
    readMcpConfig.mockImplementation(async (scope, rootPath) => {
      if (scope === 'project' && rootPath === rootB) {
        return {
          servers: {
            slack: { command: 'npx', args: ['-y', 'slack-mcp'] },
          },
        }
      }
      return { servers: {} }
    })

    await refreshStates(rootB)

    expect(readMcpConfig).toHaveBeenCalledWith('project', rootB)
    expect(mcpStop).not.toHaveBeenCalled()
    expect(serverStates.value[keyB]?.status).toBe('connected')
    expect(serverStates.value[keyA]).toEqual(githubA)
    expect(projectMcp.value.servers.github).toBeDefined()
    expect(projectMcp.value.servers.slack).toBeUndefined()
  })
})

describe('loadProjectConfigForRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedRunningBrave()
    readMcpConfig.mockResolvedValue({
      servers: {
        github: { command: 'npx', args: ['-y', 'github-mcp'] },
      },
    })
  })

  it('returns the project config without mutating global refs or writing disk', async () => {
    const loaded = await loadProjectConfigForRoot('/other/project')

    expect(loaded.servers.github).toEqual({
      command: 'npx',
      args: ['-y', 'github-mcp'],
    })
    expect(personalMcp.value.servers.brave).toBeDefined()
    expect(projectMcp.value.servers).toEqual({})
    expect(writeMcpConfig).not.toHaveBeenCalled()
    expect(readMcpConfig).toHaveBeenCalledWith('project', '/other/project')
  })
})
