import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@/types/vixl/mcp-config'

const { refresh, authenticate, start, stop } = vi.hoisted(() => ({
  refresh: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    serverId: 'github',
    status: 'connected',
    tools: [],
  })),
  authenticate: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    serverId: 'github',
    status: 'connected',
    tools: [],
  })),
  start: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    serverId: 'github',
    status: 'connected',
    tools: [],
  })),
  stop: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    refresh: (...args: unknown[]) => refresh(...args),
    authenticate: (...args: unknown[]) => authenticate(...args),
    start: (...args: unknown[]) => start(...args),
    stop: (...args: unknown[]) => stop(...args),
  },
}))

import { toast } from 'vue-sonner'
import {
  createAuthenticateServer,
  createRefreshOrStartServer,
  createStartServer,
  refreshServer,
  stopServer,
} from '@/composables/mcp-servers/lifecycle'
import { authenticatingServers, serverStates } from '@/composables/mcp-servers/state'
import connectionKey from '@/services/mcp/connection-key'

const serverConfig: McpServerConfig = {
  command: 'npx',
  args: ['-y', 'example-mcp'],
}

describe('createRefreshOrStartServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverStates.value = {}
  })

  it('refreshes when the server is connected', async () => {
    serverStates.value = {
      [connectionKey(undefined, 'github')]: { serverId: 'github', status: 'connected', tools: [] },
    }
    const startServer = vi.fn<ReturnType<typeof createStartServer>>(async () => {})
    const refreshOrStartServer = createRefreshOrStartServer(startServer)

    await refreshOrStartServer('github', serverConfig)

     expect(refresh).toHaveBeenCalledWith('github', serverConfig, undefined)
    expect(startServer).not.toHaveBeenCalled()
  })

  it('starts when the server is in error', async () => {
    serverStates.value = {
      [connectionKey(undefined, 'github')]: {
        serverId: 'github',
        status: 'error',
        tools: [],
        error: 'died',
      },
    }
    const startServer = vi.fn<ReturnType<typeof createStartServer>>(async () => {})
    const refreshOrStartServer = createRefreshOrStartServer(startServer)

    await refreshOrStartServer('github', serverConfig, { quiet: true })

    expect(startServer).toHaveBeenCalledWith('github', serverConfig, {
      quiet: true,
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('starts when the server is stopped', async () => {
    serverStates.value = {
      [connectionKey(undefined, 'github')]: { serverId: 'github', status: 'stopped', tools: [] },
    }
    const startServer = vi.fn<ReturnType<typeof createStartServer>>(async () => {})
    const refreshOrStartServer = createRefreshOrStartServer(startServer)

    await refreshOrStartServer('github', serverConfig, { quiet: true })

    expect(startServer).toHaveBeenCalledWith('github', serverConfig, {
      quiet: true,
    })
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('refreshServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverStates.value = {
      [connectionKey(undefined, 'github')]: { serverId: 'github', status: 'connected', tools: [{ name: 'search' }] },
    }
  })

  it('patches stopped when the process is not running', async () => {
    refresh.mockRejectedValueOnce(new Error('Server not running'))

    await refreshServer('github', serverConfig)

    expect(serverStates.value[connectionKey(undefined, 'github')]).toEqual({
      serverId: 'github',
      status: 'stopped',
      tools: [],
      error: 'Server not running',
    })
  })

  it('patches error for other refresh failures', async () => {
    refresh.mockRejectedValueOnce(new Error('tools/list timed out'))

    await refreshServer('github', serverConfig)

    expect(serverStates.value[connectionKey(undefined, 'github')]).toEqual({
      serverId: 'github',
      status: 'error',
      tools: [],
      error: 'tools/list timed out',
    })
  })
})

describe('createAuthenticateServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticatingServers.value = {}
    serverStates.value = {
      [connectionKey(undefined, 'github')]: {
        serverId: 'github',
        status: 'auth_required',
        tools: [],
        error: 'Authentication cancelled',
      },
    }
  })

  it('does not toast Authentication failed when OAuth is cancelled', async () => {
    authenticate.mockRejectedValueOnce(new Error('OAuth callback aborted'))
    const authenticateServer = createAuthenticateServer(
      () => undefined,
      () => ({}),
    )

    await expect(authenticateServer('github', serverConfig)).rejects.toThrow(
      'OAuth callback aborted',
    )

    expect(toast.error).not.toHaveBeenCalled()
    expect(serverStates.value[connectionKey(undefined, 'github')]).toEqual({
      serverId: 'github',
      status: 'auth_required',
      tools: [],
      error: 'Authentication cancelled',
    })
    expect(authenticatingServers.value[connectionKey(undefined, 'github')]).toBe(false)
  })
})

describe('project-scoped servers with the same id stay independent', () => {
  const rootA = '/tmp/project-a'
  const rootB = '/tmp/project-b'
  const keyA = connectionKey(rootA, 'github')
  const keyB = connectionKey(rootB, 'github')
  const runtimeOptions = (extras?: { scopeKey?: string | null }) => extras ?? {}

  beforeEach(() => {
    vi.clearAllMocks()
    serverStates.value = {}
    start.mockImplementation(async (serverId: unknown, _config: unknown, extras: unknown) => {
      const scopeKey =
        extras && typeof extras === 'object' && 'scopeKey' in extras
          ? (extras as { scopeKey?: string | null }).scopeKey
          : undefined
      return {
        serverId,
        status: 'connected',
        tools: [{ name: `ping:${scopeKey}` }],
      }
    })
    refresh.mockImplementation(async (serverId: unknown, _config: unknown, scopeKey: unknown) => {
      const key = connectionKey(scopeKey as string | null, String(serverId))
      const existing = serverStates.value[key]
      if (!existing || existing.status !== 'connected') {
        throw new Error('Server not running')
      }
      return {
        serverId,
        status: 'connected',
        tools: [...existing.tools, { name: `status:${scopeKey}` }],
      }
    })
  })

  it('starting, refreshing, and stopping one root does not affect the other', async () => {
    const startServer = createStartServer(() => undefined, runtimeOptions)
    const refreshOrStartServer = createRefreshOrStartServer(startServer)

    await startServer('github', serverConfig, { quiet: true, scopeKey: rootA })
    await startServer('github', serverConfig, { quiet: true, scopeKey: rootB })

    expect(start).toHaveBeenCalledWith(
      'github',
      serverConfig,
      expect.objectContaining({ scopeKey: rootA }),
    )
    expect(start).toHaveBeenCalledWith(
      'github',
      serverConfig,
      expect.objectContaining({ scopeKey: rootB }),
    )
    expect(serverStates.value[keyA]).toEqual({
      serverId: 'github',
      status: 'connected',
      tools: [{ name: `ping:${rootA}` }],
    })
    expect(serverStates.value[keyB]).toEqual({
      serverId: 'github',
      status: 'connected',
      tools: [{ name: `ping:${rootB}` }],
    })

    await refreshServer('github', serverConfig, { quiet: true, scopeKey: rootA })

    expect(refresh).toHaveBeenCalledWith('github', serverConfig, rootA)
    expect(refresh).not.toHaveBeenCalledWith('github', serverConfig, rootB)
    expect(serverStates.value[keyA]?.tools).toEqual([
      { name: `ping:${rootA}` },
      { name: `status:${rootA}` },
    ])
    expect(serverStates.value[keyB]?.tools).toEqual([{ name: `ping:${rootB}` }])

    await stopServer('github', { quiet: true, scopeKey: rootA, config: serverConfig })

    expect(stop).toHaveBeenCalledWith('github', serverConfig, rootA)
    expect(stop).not.toHaveBeenCalledWith('github', serverConfig, rootB)
    expect(serverStates.value[keyA]?.status).toBe('stopped')
    expect(serverStates.value[keyB]?.status).toBe('connected')

    await refreshOrStartServer('github', serverConfig, { quiet: true, scopeKey: rootB })
    expect(refresh).toHaveBeenCalledWith('github', serverConfig, rootB)
    expect(start).toHaveBeenCalledTimes(2)
  })
})
