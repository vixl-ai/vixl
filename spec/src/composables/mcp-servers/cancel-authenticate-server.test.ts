import { beforeEach, describe, expect, it, vi } from 'vitest'

const cancelAuthenticate = vi.hoisted(() =>
  vi.fn<(serverId: string) => boolean>(() => true),
)

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    cancelAuthenticate: (serverId: string) => cancelAuthenticate(serverId),
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

describe('cancelAuthenticateServer', () => {
  beforeEach(() => {
    cancelAuthenticate.mockClear()
    cancelAuthenticate.mockReturnValue(true)
    vi.mocked(toast.success).mockClear()
    authenticatingServers.value = {}
    serverStates.value = {}
  })

  it('patches auth_required state and clears the authenticating flag', () => {
    authenticatingServers.value = { github: true }

    cancelAuthenticateServer('github')

    expect(cancelAuthenticate).toHaveBeenCalledWith('github')
    expect(serverStates.value.github).toEqual({
      serverId: 'github',
      status: 'auth_required',
      tools: [],
      error: 'Authentication cancelled',
    })
    expect(authenticatingServers.value.github).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Authentication cancelled')
  })

  it('is idempotent when no authenticating flag is set', () => {
    cancelAuthenticate.mockReturnValue(false)

    cancelAuthenticateServer('github')

    expect(cancelAuthenticate).toHaveBeenCalledWith('github')
    expect(authenticatingServers.value.github).toBe(false)
    expect(serverStates.value.github?.status).toBe('auth_required')
  })
})
