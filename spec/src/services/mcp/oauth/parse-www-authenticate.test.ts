import { describe, expect, it } from 'vitest'
import parseWwwAuthenticate from '@/services/mcp/oauth/parse-www-authenticate'

describe('parseWwwAuthenticate', () => {
  it('parses Bearer resource_metadata and scope from a 401 challenge', () => {
    const challenge = parseWwwAuthenticate(
      'Bearer realm="mcp", resource_metadata="https://mcp.example/.well-known/oauth-protected-resource", scope="mcp:tools"',
    )

    expect(challenge?.resourceMetadataUrl?.href).toBe(
      'https://mcp.example/.well-known/oauth-protected-resource',
    )
    expect(challenge?.scope).toBe('mcp:tools')
    expect(challenge?.error).toBeUndefined()
  })

  it('parses 403 insufficient_scope and the required scope', () => {
    const challenge = parseWwwAuthenticate(
      'Bearer error="insufficient_scope", error_description="Need more access", scope="read write"',
    )

    expect(challenge?.error).toBe('insufficient_scope')
    expect(challenge?.scope).toBe('read write')
    expect(challenge?.resourceMetadataUrl).toBeUndefined()
  })

  it('ignores non-Bearer schemes and invalid resource_metadata URLs', () => {
    expect(parseWwwAuthenticate('Basic realm="x"')).toBeUndefined()
    expect(
      parseWwwAuthenticate('Bearer resource_metadata="not a url", scope="read"'),
    ).toEqual({
      resourceMetadataUrl: undefined,
      scope: 'read',
      error: undefined,
    })
  })
})
