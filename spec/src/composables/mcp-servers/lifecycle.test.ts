import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@/types/vixl/mcp-config'

const { refresh, authenticate } = vi.hoisted(() => ({
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
  },
}))

import { toast } from 'vue-sonner'
import {
  createAuthenticateServer,
  createRefreshOrStartServer,
  createStartServer,
  refreshServer,
} from '@/composables/mcp-servers/lifecycle'
import { authenticatingServers, serverStates } from '@/composables/mcp-servers/state'

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
      github: { serverId: 'github', status: 'connected', tools: [] },
    }
    const startServer = vi.fn<ReturnType<typeof createStartServer>>(async () => {})
    const refreshOrStartServer = createRefreshOrStartServer(startServer)

    await refreshOrStartServer('github', serverConfig)

    expect(refresh).toHaveBeenCalledWith('github', serverConfig)
    expect(startServer).not.toHaveBeenCalled()
  })

  it('starts when the server is in error', async () => {
    serverStates.value = {
      github: {
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
      github: { serverId: 'github', status: 'stopped', tools: [] },
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
      github: { serverId: 'github', status: 'connected', tools: [{ name: 'search' }] },
    }
  })

  it('patches stopped when the process is not running', async () => {
    refresh.mockRejectedValueOnce(new Error('Server not running'))

    await refreshServer('github', serverConfig)

    expect(serverStates.value.github).toEqual({
      serverId: 'github',
      status: 'stopped',
      tools: [],
      error: 'Server not running',
    })
  })

  it('patches error for other refresh failures', async () => {
    refresh.mockRejectedValueOnce(new Error('tools/list timed out'))

    await refreshServer('github', serverConfig)

    expect(serverStates.value.github).toEqual({
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
      github: {
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
    expect(serverStates.value.github).toEqual({
      serverId: 'github',
      status: 'auth_required',
      tools: [],
      error: 'Authentication cancelled',
    })
    expect(authenticatingServers.value.github).toBe(false)
  })
})
