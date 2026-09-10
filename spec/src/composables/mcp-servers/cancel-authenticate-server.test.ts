import { beforeEach, describe, expect, it, vi } from 'vitest'

const cancelAuthenticate = vi.hoisted(() =>
  vi.fn<(serverId: string, scopeKey?: string | null) => boolean>(() => true),
)

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    cancelAuthenticate: (serverId: string, scopeKey?: string | null) =>
      cancelAuthenticate(serverId, scopeKey),
  },
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

import { toast } from 'vue-sonner'
import cancelAuthenticateServer from '@/composables/mcp-servers/cancel-authenticate-server'
import {
  authenticatingServers,
  serverStates,
} from '@/composables/mcp-servers/state'
import connectionKey from '@/services/mcp/connection-key'

describe('cancelAuthenticateServer', () => {
  beforeEach(() => {
    cancelAuthenticate.mockClear()
    cancelAuthenticate.mockReturnValue(true)
    vi.mocked(toast.success).mockClear()
    authenticatingServers.value = {}
    serverStates.value = {}
  })

  it('patches auth_required state and clears the authenticating flag', () => {
    const key = connectionKey(undefined, 'github')
    authenticatingServers.value = { [key]: true }

    cancelAuthenticateServer('github')

    expect(cancelAuthenticate).toHaveBeenCalledWith('github', undefined)
    expect(serverStates.value[key]).toEqual({
      serverId: 'github',
      status: 'auth_required',
      tools: [],
      error: 'Authentication cancelled',
    })
    expect(authenticatingServers.value[key]).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Authentication cancelled')
  })

  it('is idempotent when no authenticating flag is set', () => {
    cancelAuthenticate.mockReturnValue(false)

    cancelAuthenticateServer('github')

    expect(cancelAuthenticate).toHaveBeenCalledWith('github', undefined)
    expect(authenticatingServers.value[connectionKey(undefined, 'github')]).toBe(false)
    expect(serverStates.value[connectionKey(undefined, 'github')]?.status).toBe('auth_required')
  })

  it('patches and clears flags under the provided scope key', () => {
    const key = connectionKey('/tmp/project', 'github')
    authenticatingServers.value = { [key]: true }

    cancelAuthenticateServer('github', '/tmp/project')

    expect(cancelAuthenticate).toHaveBeenCalledWith('github', '/tmp/project')
    expect(serverStates.value[key]?.status).toBe('auth_required')
    expect(authenticatingServers.value[key]).toBe(false)
    expect(serverStates.value[connectionKey(undefined, 'github')]).toBeUndefined()
  })
})
