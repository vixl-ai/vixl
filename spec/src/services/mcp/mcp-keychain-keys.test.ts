import { describe, expect, it } from 'vitest'
import {
  mcpInputKey,
  mcpKnownSecretKeys,
  mcpOAuthAsInfoKey,
  mcpOAuthClientKey,
  mcpOAuthStateKey,
  mcpOAuthTokensKey,
  mcpOAuthVerifierKey,
} from '@/services/mcp/mcp-keychain-keys'

describe('mcp-keychain-keys', () => {
  it('formats oauth and input keychain keys', () => {
    expect(mcpOAuthTokensKey('github')).toBe('vixl:mcp:github:oauth:tokens')
    expect(mcpOAuthVerifierKey('github')).toBe('vixl:mcp:github:oauth:verifier')
    expect(mcpOAuthClientKey('github')).toBe('vixl:mcp:github:oauth:client')
    expect(mcpOAuthStateKey('github')).toBe('vixl:mcp:github:oauth:state')
    expect(mcpOAuthAsInfoKey('github')).toBe('vixl:mcp:github:oauth:as')
    expect(mcpInputKey('github', 'token')).toBe('vixl:mcp:github:input:token')
  })

  it('lists known secret keys including inputs', () => {
    expect(mcpKnownSecretKeys('linear')).toEqual([
      'vixl:mcp:linear:oauth:tokens',
      'vixl:mcp:linear:oauth:verifier',
      'vixl:mcp:linear:oauth:client',
      'vixl:mcp:linear:oauth:state',
      'vixl:mcp:linear:oauth:as',
    ])

    expect(mcpKnownSecretKeys('linear', ['apiKey', 'org'])).toEqual([
      'vixl:mcp:linear:oauth:tokens',
      'vixl:mcp:linear:oauth:verifier',
      'vixl:mcp:linear:oauth:client',
      'vixl:mcp:linear:oauth:state',
      'vixl:mcp:linear:oauth:as',
      'vixl:mcp:linear:input:apiKey',
      'vixl:mcp:linear:input:org',
    ])
  })
})
