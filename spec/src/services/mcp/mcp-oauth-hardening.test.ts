import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const proxyFetchImpl = vi.hoisted(() =>
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response('{}', { status: 200 }),
  ),
)

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

vi.mock('@/services/providers/proxy-fetch', () => ({
  default: () => proxyFetchImpl,
}))

import { createVixlOAuthProvider } from '@/services/mcp/vixl-oauth-provider'
import { mcpOAuthFetch } from '@/services/mcp/mcp-oauth-fetch'

describe('vixl oauth AS confirm', () => {
  it('requires confirmation when no allowlist and no pin', async () => {
    const confirm = vi.fn<(origin: string) => Promise<boolean>>(async () => false)
    const provider = createVixlOAuthProvider({
      serverId: 'demo',
      serverUrl: 'https://mcp.example',
      redirectUrl: 'http://127.0.0.1/callback',
      openUrl: async () => {},
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
})

describe('mcpOAuthFetch', () => {
  beforeEach(() => {
    proxyFetchImpl.mockClear()
    proxyFetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
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
})
