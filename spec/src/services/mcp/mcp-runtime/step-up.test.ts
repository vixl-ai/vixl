import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpHttpServer, McpServerConfig } from '@/types/vixl/mcp-config'
import type { McpServerState } from '@/services/vixl/vixl-tauri'
import type { WwwAuthenticateChallenge } from '@/types/mcp/www-authenticate-challenge'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const {
  callHttpTool,
  getHttpLastRequestedScope,
  getHttpOauthChallenge,
  getHttpServerConfig,
} = vi.hoisted(() => ({
  callHttpTool: vi.fn<
    (
      serverId: string,
      tool: string,
      args: Record<string, unknown>,
      scopeKey?: string | null,
    ) => Promise<unknown>
  >(),
  getHttpLastRequestedScope: vi.fn<
    (serverId: string, scopeKey?: string | null) => string | undefined
  >(() => undefined),
  getHttpOauthChallenge: vi.fn<
    (serverId: string, scopeKey?: string | null) => WwwAuthenticateChallenge | undefined
  >(),
  getHttpServerConfig: vi.fn<
    (serverId: string, scopeKey?: string | null) => McpHttpServer | undefined
  >(),
}))

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

vi.mock('@/services/mcp/mcp-http-client', () => ({
  callHttpTool: (
    serverId: string,
    tool: string,
    args: Record<string, unknown>,
    scopeKey?: string | null,
  ) => callHttpTool(serverId, tool, args, scopeKey),
  getHttpLastRequestedScope: (
    serverId: string,
    scopeKey?: string | null,
  ) => getHttpLastRequestedScope(serverId, scopeKey),
  getHttpOauthChallenge: (serverId: string, scopeKey?: string | null) =>
    getHttpOauthChallenge(serverId, scopeKey),
  getHttpServerConfig: (serverId: string, scopeKey?: string | null) =>
    getHttpServerConfig(serverId, scopeKey),
}))

vi.mock('@/services/mcp/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/mcp/oauth')>()
  return {
    ...actual,
    getLastOAuthChallenge: vi.fn<() => undefined>(() => undefined),
  }
})

import callHttpToolWithStepUp from '@/services/mcp/mcp-runtime/step-up'

const httpConfig: McpHttpServer = {
  type: 'http',
  url: 'https://mcp.example/github',
}

const connected: McpServerState = {
  serverId: 'github',
  status: 'connected',
  tools: [],
}

const insufficient = Object.assign(new Error('HTTP 403'), { statusCode: 403 })

const challenge: WwwAuthenticateChallenge = {
  error: 'insufficient_scope',
  scope: 'repo',
}

describe('callHttpToolWithStepUp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getHttpOauthChallenge.mockReturnValue(challenge)
    getHttpServerConfig.mockReturnValue(httpConfig)
    getHttpLastRequestedScope.mockReturnValue(undefined)
  })

  it('does not share step-up attempts across scopes for the same server and tool', async () => {
    const projectRoot = '/tmp/project'
    let projectFails = 0
    let resumePersonalAuth: (() => void) | undefined
    const personalAuthGate = new Promise<void>((resolve) => {
      resumePersonalAuth = resolve
    })

    callHttpTool.mockImplementation(async (_serverId, _tool, _args, scopeKey) => {
      if (scopeKey === projectRoot) {
        projectFails += 1
        if (projectFails <= 2) {
          throw insufficient
        }
        return 'project-ok'
      }
      throw insufficient
    })

    const authenticate = vi.fn<
      (
        serverId: string,
        config: McpServerConfig,
        options?: { scopeKey?: string | null },
      ) => Promise<McpServerState>
    >(async (_serverId, _config, options) => {
      if (!options?.scopeKey) {
        await personalAuthGate
      }
      return connected
    })

    const personalPending = callHttpToolWithStepUp(
      'github',
      'search',
      {},
      httpConfig,
      authenticate,
    )
    await vi.waitFor(() => {
      expect(authenticate).toHaveBeenCalled()
    })

    await expect(
      callHttpToolWithStepUp(
        'github',
        'search',
        {},
        httpConfig,
        authenticate,
        projectRoot,
      ),
    ).resolves.toBe('project-ok')
    expect(projectFails).toBe(3)

    resumePersonalAuth?.()
    await expect(personalPending).rejects.toThrow('HTTP 403')
  })
})
