import { describe, expect, it } from 'vitest'
import { clientAllowsRedirect } from '@/services/mcp/oauth'

describe('clientAllowsRedirect', () => {
  it('rejects a client with no redirect uris', () => {
    expect(clientAllowsRedirect({}, 'http://127.0.0.1:9/callback')).toBe(false)
  })

  it('accepts an exact redirect uri match', () => {
    expect(
      clientAllowsRedirect(
        { redirect_uris: ['http://127.0.0.1:4242/callback'] },
        'http://127.0.0.1:4242/callback',
      ),
    ).toBe(true)
  })

  it('rejects a different loopback port', () => {
    expect(
      clientAllowsRedirect(
        { redirect_uris: ['http://127.0.0.1:4242/callback'] },
        'http://127.0.0.1:5555/callback',
      ),
    ).toBe(false)
  })
})
