import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpHttpServer, McpStdioServer } from '@/types/vixl/mcp-config'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const { getSecret, setSecret, deleteSecret } = vi.hoisted(() => ({
  getSecret: vi.fn<(key: string) => Promise<string | null>>(),
  setSecret: vi.fn<(key: string, value: string) => Promise<void>>(),
  deleteSecret: vi.fn<(key: string) => Promise<void>>(),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    getSecret,
    setSecret,
    deleteSecret,
  }),
)

import {
  listRequiredInputIdsForServer,
  loadMcpInputValues,
  saveMcpInputValues,
} from '@/services/mcp/resolve-mcp-inputs'

describe('resolve-mcp-inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists required input ids from stdio env and args', () => {
    const server: McpStdioServer = {
      command: 'npx',
      args: ['--token', '${input:cliToken}', 'run'],
      env: {
        API_KEY: '${input:apiKey}',
        PATH: '/usr/bin',
      },
    }

    expect(listRequiredInputIdsForServer(server).sort()).toEqual([
      'apiKey',
      'cliToken',
    ])
  })

  it('lists required input ids from http headers', () => {
    const server: McpHttpServer = {
      type: 'http',
      url: 'https://mcp.example.com',
      headers: {
        Authorization: 'Bearer ${input:token}',
        'X-Org': '${input:org}',
      },
    }

    expect(listRequiredInputIdsForServer(server).sort()).toEqual(['org', 'token'])
  })

  it('loads and saves input values via keychain', async () => {
    getSecret.mockImplementation(async (key) => {
      if (key === 'vixl:mcp:github:input:token') {
        return 'stored'
      }
      return null
    })
    setSecret.mockResolvedValue(undefined)

    const loaded = await loadMcpInputValues('github', ['token', 'missing'])
    expect(loaded).toEqual({
      values: { token: 'stored' },
      missing: ['missing'],
    })
    expect(getSecret).toHaveBeenCalledWith('vixl:mcp:github:input:token')
    expect(getSecret).toHaveBeenCalledWith('vixl:mcp:github:input:missing')

    await saveMcpInputValues('github', { token: 'next' })
    expect(setSecret).toHaveBeenCalledWith('vixl:mcp:github:input:token', 'next')
  })
})
