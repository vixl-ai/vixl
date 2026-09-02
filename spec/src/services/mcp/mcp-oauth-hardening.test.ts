import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAuthCallbackPayload } from '@/services/mcp/mcp-runtime/types'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import { mockTauriEvent } from '../../test-utils/mocks/tauri-event'

const proxyFetchImpl = vi.hoisted(() =>
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response('{}', { status: 200 }),
  ),
)

const secrets = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    store,
    getSecret: vi.fn<(key: string) => Promise<string | null>>(async (key) =>
      store.get(key) ?? null,
    ),
    setSecret: vi.fn<(key: string, value: string) => Promise<void>>(async (key, value) => {
      store.set(key, value)
    }),
    deleteSecret: vi.fn<(key: string) => Promise<void>>(async (key) => {
      store.delete(key)
    }),
  }
})

type CallbackListener = (event: { payload: OAuthCallbackPayload }) => void

const listen = vi.hoisted(() =>
  vi.fn<(event: string, handler: CallbackListener) => Promise<() => void>>(
    async () => () => {},
  ),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    getSecret: secrets.getSecret,
    setSecret: secrets.setSecret,
    deleteSecret: secrets.deleteSecret,
  }),
)

vi.mock('@tauri-apps/api/event', () => mockTauriEvent({ listen }))

vi.mock('@/services/providers/proxy-fetch', () => ({
  default: () => proxyFetchImpl,
}))

import { createVixlOAuthProvider } from '@/services/mcp/vixl-oauth-provider'
import { mcpOAuthFetch } from '@/services/mcp/mcp-oauth-fetch'
import {
  applyOAuthCallback,
  assertAuthorizationResponse,
  getLastOAuthChallenge,
  resetLastOAuthChallengesForTests,
} from '@/services/mcp/oauth'
import {
  mcpOAuthAsInfoKey,
  mcpOAuthClientKey,
  mcpOAuthStaticClientKey,
  mcpOAuthTokensKey,
} from '@/services/mcp/mcp-keychain-keys'
import { waitForOAuthCallback } from '@/services/mcp/mcp-runtime/oauth'

const createProvider = (
  overrides: Partial<Parameters<typeof createVixlOAuthProvider>[0]> = {},
) =>
  createVixlOAuthProvider({
    serverId: 'demo',
    serverUrl: 'https://mcp.example/mcp',
    redirectUrl: 'http://127.0.0.1/callback',
    openUrl: async () => {},
    ...overrides,
  })

describe('vixl oauth AS confirm', () => {
  beforeEach(() => {
    secrets.store.clear()
    secrets.getSecret.mockClear()
    secrets.setSecret.mockClear()
    secrets.deleteSecret.mockClear()
  })

  it('requires confirmation when no allowlist and no pin', async () => {
    const confirm = vi.fn<(origin: string) => Promise<boolean>>(async () => false)
    const provider = createProvider({
      confirmAuthorizationServerOrigin: confirm,
    })

    await expect(
      provider.validateAuthorizationServerURL?.(
        'https://mcp.example',
        'https://auth.evil.example',
      ),
    ).rejects.toThrow(/not confirmed/)
    expect(confirm).toHaveBeenCalledWith('https://auth.evil.example')
  })

  it('pins a same-origin authorization server without confirmation', async () => {
    const confirm = vi.fn<(origin: string) => Promise<boolean>>(async () => false)
    const provider = createProvider({
      confirmAuthorizationServerOrigin: confirm,
    })

    await provider.validateAuthorizationServerURL?.(
      'https://durabull-production-g7zyw.ondigitalocean.app/mcp',
      'https://durabull-production-g7zyw.ondigitalocean.app',
    )

    expect(confirm).not.toHaveBeenCalled()
    const stored = JSON.parse(
      secrets.store.get(mcpOAuthAsInfoKey('demo')) ?? '{}',
    ) as { origin?: string }
    expect(stored.origin).toBe(
      'https://durabull-production-g7zyw.ondigitalocean.app',
    )
  })
})

describe('vixl oauth provider', () => {
  beforeEach(() => {
    secrets.store.clear()
    secrets.getSecret.mockClear()
    secrets.setSecret.mockClear()
    secrets.deleteSecret.mockClear()
  })

  it('sets application_type to native', () => {
    const provider = createProvider()
    expect(provider.clientMetadata.application_type).toBe('native')
  })

  it('invalidates DCR client info when the AS origin changes', async () => {
    const confirm = vi.fn<(origin: string) => Promise<boolean>>(async () => true)
    const provider = createProvider({
      confirmAuthorizationServerOrigin: confirm,
    })

    await secrets.setSecret(
      mcpOAuthClientKey('demo'),
      JSON.stringify({ client_id: 'dcr-client', issuer: 'https://auth.example' }),
    )
    await secrets.setSecret(
      mcpOAuthTokensKey('demo'),
      JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }),
    )
    await secrets.setSecret(
      mcpOAuthAsInfoKey('demo'),
      JSON.stringify({
        origin: 'https://auth.example',
        issuer: 'https://auth.example',
        authorizationServerUrl: 'https://auth.example',
        tokenEndpoint: 'https://auth.example/token',
      }),
    )

    await provider.validateAuthorizationServerURL?.(
      'https://mcp.example',
      'https://auth-b.example',
    )

    expect(confirm).toHaveBeenCalledWith('https://auth-b.example')
    expect(await secrets.getSecret(mcpOAuthClientKey('demo'))).toBeNull()
    expect(await secrets.getSecret(mcpOAuthTokensKey('demo'))).toBeNull()
    expect(await provider.clientInformation()).toBeUndefined()
  })

  it('does not reuse a pre-registered client when the AS origin changes', async () => {
    const provider = createProvider({
      clientId: 'static-client',
    })

    await secrets.setSecret(
      mcpOAuthClientKey('demo'),
      JSON.stringify({ client_id: 'static-client', issuer: 'https://auth.example' }),
    )
    await secrets.setSecret(
      mcpOAuthAsInfoKey('demo'),
      JSON.stringify({
        origin: 'https://auth.example',
        issuer: 'https://auth.example',
        authorizationServerUrl: 'https://auth.example',
        tokenEndpoint: 'https://auth.example/token',
      }),
    )

    await expect(
      provider.validateAuthorizationServerURL?.(
        'https://mcp.example',
        'https://auth-b.example',
      ),
    ).rejects.toThrow(/different authorization server issuer/)

    expect(await secrets.getSecret(mcpOAuthClientKey('demo'))).toContain(
      'static-client',
    )
  })

  it('uses a keychain static client when config has no clientId', async () => {
    const provider = createProvider()
    await secrets.setSecret(
      mcpOAuthStaticClientKey('demo'),
      JSON.stringify({
        client_id: 'pre-registered',
        client_secret: 'shh',
      }),
    )

    await expect(provider.clientInformation()).resolves.toEqual({
      client_id: 'pre-registered',
      client_secret: 'shh',
    })
  })

  it('rejects a protected resource that does not match the MCP server', async () => {
    const provider = createProvider()
    await expect(
      provider.validateResourceURL?.(
        'https://mcp.example/mcp',
        'https://other.example/mcp',
      ),
    ).rejects.toThrow(/does not match/)
  })

  it('accepts a protected resource that matches the MCP server', async () => {
    const provider = createProvider()
    const resource = await provider.validateResourceURL?.(
      'https://mcp.example/mcp',
      'https://mcp.example/mcp',
    )
    expect(resource).toBeInstanceOf(URL)
    expect(resource?.href).toBe('https://mcp.example/mcp')
  })

  it('persists issuer and iss-parameter support on AS info', async () => {
    proxyFetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          issuer: 'https://auth.example',
          authorization_endpoint: 'https://auth.example/authorize',
          token_endpoint: 'https://auth.example/token',
          response_types_supported: ['code'],
          authorization_response_iss_parameter_supported: true,
        }),
        { status: 200 },
      ),
    )
    const provider = createProvider()
    await provider.saveAuthorizationServerInformation?.({
      issuer: 'https://auth.example',
      authorizationServerUrl: 'https://auth.example',
      tokenEndpoint: 'https://auth.example/token',
    })

    const stored = JSON.parse(
      (await secrets.getSecret(mcpOAuthAsInfoKey('demo'))) ?? '{}',
    ) as {
      issuer?: string
      authorization_response_iss_parameter_supported?: boolean
    }
    expect(stored.issuer).toBe('https://auth.example')
    expect(stored.authorization_response_iss_parameter_supported).toBe(true)
  })

  it('stores the current redirect uri with DCR client information', async () => {
    const provider = createProvider({
      redirectUrl: 'http://127.0.0.1:4242/callback',
    })
    await provider.saveClientInformation?.({ client_id: 'dcr' })

    const stored = JSON.parse(
      (await secrets.getSecret(mcpOAuthClientKey('demo'))) ?? '{}',
    ) as { redirect_uris?: string[] }
    expect(stored.redirect_uris).toEqual(['http://127.0.0.1:4242/callback'])
  })

  it('reuses a DCR client registered for the current redirect uri', async () => {
    const provider = createProvider({
      redirectUrl: 'http://127.0.0.1:4242/callback',
    })
    await secrets.setSecret(
      mcpOAuthClientKey('demo'),
      JSON.stringify({
        client_id: 'dcr',
        redirect_uris: ['http://127.0.0.1:4242/callback'],
      }),
    )

    await expect(provider.clientInformation()).resolves.toMatchObject({
      client_id: 'dcr',
    })
  })

  it('drops a DCR client whose redirect uri does not match the loopback url', async () => {
    const provider = createProvider({
      redirectUrl: 'http://127.0.0.1:5555/callback',
    })
    await secrets.setSecret(
      mcpOAuthClientKey('demo'),
      JSON.stringify({
        client_id: 'stale',
        redirect_uris: ['http://127.0.0.1/oauth-pending'],
      }),
    )
    await secrets.setSecret(
      mcpOAuthTokensKey('demo'),
      JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }),
    )
    await secrets.setSecret(
      mcpOAuthAsInfoKey('demo'),
      JSON.stringify({
        origin: 'https://auth.example',
        issuer: 'https://auth.example',
        authorizationServerUrl: 'https://auth.example',
        tokenEndpoint: 'https://auth.example/token',
      }),
    )

    await expect(provider.clientInformation()).resolves.toBeUndefined()
    expect(await secrets.getSecret(mcpOAuthClientKey('demo'))).toBeNull()
    expect(await secrets.getSecret(mcpOAuthTokensKey('demo'))).toBeNull()
    expect(await secrets.getSecret(mcpOAuthAsInfoKey('demo'))).not.toBeNull()
  })

  it('drops a legacy DCR client that has no stored redirect uris', async () => {
    const provider = createProvider({
      redirectUrl: 'http://127.0.0.1:5555/callback',
    })
    await secrets.setSecret(
      mcpOAuthClientKey('demo'),
      JSON.stringify({ client_id: 'legacy' }),
    )

    await expect(provider.clientInformation()).resolves.toBeUndefined()
    expect(await secrets.getSecret(mcpOAuthClientKey('demo'))).toBeNull()
  })

  it('does not register during start when dynamic registration is disabled', async () => {
    const provider = createProvider({
      redirectUrl: 'http://127.0.0.1/oauth-pending',
      allowDynamicRegistration: false,
    })
    expect(provider.saveClientInformation).toBeUndefined()
    await secrets.setSecret(
      mcpOAuthClientKey('demo'),
      JSON.stringify({
        client_id: 'keep-me',
        redirect_uris: ['http://127.0.0.1:4242/callback'],
      }),
    )

    await expect(provider.clientInformation()).resolves.toMatchObject({
      client_id: 'keep-me',
    })
  })
})

describe('RFC 9207 authorization response', () => {
  beforeEach(() => {
    secrets.store.clear()
    secrets.getSecret.mockClear()
    secrets.setSecret.mockClear()
    secrets.deleteSecret.mockClear()
    proxyFetchImpl.mockClear()
    proxyFetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
  })

  it('rejects a missing iss when the AS advertises iss support', () => {
    expect(() =>
      assertAuthorizationResponse({
        expectedIssuer: 'https://auth.example',
        authorizationResponseIssParameterSupported: true,
      }),
    ).toThrow(/mixed up/)
  })

  it('does not surface error_description on issuer mismatch', async () => {
    const provider = createProvider()
    await secrets.setSecret(
      mcpOAuthAsInfoKey('demo'),
      JSON.stringify({
        issuer: 'https://auth.example',
        authorizationServerUrl: 'https://auth.example',
        tokenEndpoint: 'https://auth.example/token',
        authorization_response_iss_parameter_supported: true,
      }),
    )

    const error = await applyOAuthCallback(provider, {
      code: '',
      state: 'xyz',
      iss: 'https://evil.example',
      error: 'access_denied',
      errorDescription: 'User denied the request',
      errorUri: 'https://evil.example/e',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('OAuth authorization response mixed up')
    expect((error as Error).message).not.toContain('User denied')
    expect((error as Error).message).not.toContain('access_denied')
    expect((error as Error).message).not.toContain('error_description')
    expect(proxyFetchImpl).not.toHaveBeenCalled()
  })

  it('does not attempt token exchange when a success callback has the wrong iss', async () => {
    const provider = createProvider()
    await secrets.setSecret(
      mcpOAuthAsInfoKey('demo'),
      JSON.stringify({
        issuer: 'https://auth.example',
        authorizationServerUrl: 'https://auth.example',
        tokenEndpoint: 'https://auth.example/token',
        authorization_response_iss_parameter_supported: true,
      }),
    )

    await expect(
      applyOAuthCallback(provider, {
        code: 'splendid',
        state: 'xyz',
        iss: 'https://evil.example',
      }),
    ).rejects.toThrow('OAuth authorization response mixed up')
    expect(proxyFetchImpl).not.toHaveBeenCalled()
  })

  it('returns the authorization code after iss matches without exchanging tokens', async () => {
    const provider = createProvider()
    await secrets.setSecret(
      mcpOAuthAsInfoKey('demo'),
      JSON.stringify({
        issuer: 'https://auth.example',
        authorizationServerUrl: 'https://auth.example',
        tokenEndpoint: 'https://auth.example/token',
        authorization_response_iss_parameter_supported: true,
      }),
    )

    await expect(
      applyOAuthCallback(provider, {
        code: 'splendid',
        state: 'xyz',
        iss: 'https://auth.example',
      }),
    ).resolves.toEqual({
      authorizationCode: 'splendid',
      callbackState: 'xyz',
      callbackIssuer: 'https://auth.example',
    })
    expect(proxyFetchImpl).not.toHaveBeenCalled()
  })

  it('compares a present iss even when iss support is not advertised', () => {
    expect(() =>
      assertAuthorizationResponse({
        callbackIss: 'https://evil.example',
        expectedIssuer: 'https://auth.example',
        authorizationResponseIssParameterSupported: false,
      }),
    ).toThrow(/mixed up/)
  })

  it('allows a missing iss when iss support is not advertised', () => {
    expect(() =>
      assertAuthorizationResponse({
        expectedIssuer: 'https://auth.example',
        authorizationResponseIssParameterSupported: false,
      }),
    ).not.toThrow()
  })

  it('throws oauth error details only after iss validation passes', async () => {
    const provider = createProvider()
    await secrets.setSecret(
      mcpOAuthAsInfoKey('demo'),
      JSON.stringify({
        issuer: 'https://auth.example',
        authorizationServerUrl: 'https://auth.example',
        tokenEndpoint: 'https://auth.example/token',
        authorization_response_iss_parameter_supported: true,
      }),
    )

    await expect(
      applyOAuthCallback(provider, {
        code: '',
        state: 'xyz',
        iss: 'https://auth.example',
        error: 'access_denied',
        errorDescription: 'User denied the request',
      }),
    ).rejects.toThrow('access_denied: User denied the request')
  })
})

describe('waitForOAuthCallback', () => {
  beforeEach(() => {
    listen.mockReset()
    listen.mockImplementation(async () => () => {})
  })

  it('forwards a success payload including iss', async () => {
    listen.mockImplementation(async (_event, handler) => {
      queueMicrotask(() => {
        handler({
          payload: {
            code: 'splendid',
            state: 'xyz',
            iss: 'https://auth.example',
            flowId: 'demo',
          },
        })
      })
      return () => {}
    })

    const payload = await waitForOAuthCallback(new AbortController().signal, 'demo')
    expect(payload.code).toBe('splendid')
    expect(payload.state).toBe('xyz')
    expect(payload.iss).toBe('https://auth.example')
    expect(payload.error).toBeUndefined()
  })

  it('returns error payloads so RFC 9207 can run first', async () => {
    listen.mockImplementation(async (_event, handler) => {
      queueMicrotask(() => {
        handler({
          payload: {
            code: '',
            state: 'xyz',
            iss: 'https://auth.example',
            error: 'access_denied',
            errorDescription: 'User denied the request',
            flowId: 'demo',
          },
        })
      })
      return () => {}
    })

    const payload = await waitForOAuthCallback(new AbortController().signal, 'demo')
    expect(payload.error).toBe('access_denied')
    expect(payload.errorDescription).toBe('User denied the request')
    expect(payload.iss).toBe('https://auth.example')
  })

  it('rejects success-looking payloads that lack state, error, and iss', async () => {
    listen.mockImplementation(async (_event, handler) => {
      queueMicrotask(() => {
        handler({
          payload: {
            code: 'splendid',
            state: '',
            flowId: 'demo',
          },
        })
      })
      return () => {}
    })

    await expect(
      waitForOAuthCallback(new AbortController().signal, 'demo'),
    ).rejects.toThrow(/missing state/)
  })
})

describe('mcpOAuthFetch', () => {
  beforeEach(() => {
    proxyFetchImpl.mockClear()
    proxyFetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
    resetLastOAuthChallengesForTests()
  })

  it('blocks private https hosts', async () => {
    await expect(mcpOAuthFetch('https://10.0.0.1/token')).rejects.toThrow(/blocked/)
    expect(proxyFetchImpl).not.toHaveBeenCalled()
  })

  it('blocks non-localhost http', async () => {
    await expect(mcpOAuthFetch('http://example.com/token')).rejects.toThrow(/localhost/)
    expect(proxyFetchImpl).not.toHaveBeenCalled()
  })

  it('uses proxyFetch for allowed https and forces redirect error', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch')
    try {
      const response = await mcpOAuthFetch('https://auth.example/token', {
        method: 'POST',
      })

      expect(response.status).toBe(200)
      expect(globalFetch).not.toHaveBeenCalled()
      expect(proxyFetchImpl).toHaveBeenCalledTimes(1)
      expect(proxyFetchImpl.mock.calls[0]?.[0]).toBe('https://auth.example/token')
      expect(proxyFetchImpl.mock.calls[0]?.[1]).toMatchObject({
        method: 'POST',
        redirect: 'error',
      })
    } finally {
      globalFetch.mockRestore()
    }
  })

  it('records WWW-Authenticate Bearer params from 401 responses', async () => {
    proxyFetchImpl.mockResolvedValue(
      new Response('unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate':
            'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource", scope="mcp:tools"',
        },
      }),
    )

    const response = await mcpOAuthFetch('https://mcp.example/mcp')
    expect(response.status).toBe(401)
    const challenge = getLastOAuthChallenge('https://mcp.example/mcp')
    expect(challenge?.scope).toBe('mcp:tools')
    expect(challenge?.resourceMetadataUrl?.href).toBe(
      'https://mcp.example/.well-known/oauth-protected-resource',
    )
  })

  it('records insufficient_scope from 403 responses', async () => {
    proxyFetchImpl.mockResolvedValue(
      new Response('forbidden', {
        status: 403,
        headers: {
          'WWW-Authenticate':
            'Bearer error="insufficient_scope", scope="read write"',
        },
      }),
    )

    const response = await mcpOAuthFetch('https://mcp.example/mcp')
    expect(response.status).toBe(403)
    const challenge = getLastOAuthChallenge('https://mcp.example/other')
    expect(challenge?.error).toBe('insufficient_scope')
    expect(challenge?.scope).toBe('read write')
  })
})
