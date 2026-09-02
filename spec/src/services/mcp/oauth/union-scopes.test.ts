import { describe, expect, it } from 'vitest'
import unionScopes from '@/services/mcp/oauth/union-scopes'

describe('unionScopes', () => {
  it('unions previous granted scopes with insufficient_scope challenge scopes', () => {
    expect(unionScopes('read profile', 'write admin')).toBe(
      'read profile write admin',
    )
  })

  it('does not drop previously granted scopes when the challenge repeats one', () => {
    expect(unionScopes('mcp:tools email', 'mcp:tools calendar')).toBe(
      'mcp:tools email calendar',
    )
  })

  it('returns only challenge scopes when nothing was granted yet', () => {
    expect(unionScopes(undefined, 'openid profile')).toBe('openid profile')
  })

  it('returns previous scopes when the challenge has none', () => {
    expect(unionScopes('read', undefined)).toBe('read')
  })

  it('returns an empty string when both sides are empty', () => {
    expect(unionScopes(undefined, undefined)).toBe('')
    expect(unionScopes('', '   ')).toBe('')
  })
})
