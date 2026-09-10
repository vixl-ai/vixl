import { describe, expect, it } from 'vitest'
import connectionKey from '@/services/mcp/connection-key'

describe('connectionKey', () => {
  it('joins trimmed scope and server id with unit separator', () => {
    expect(connectionKey('/tmp/project', 'github')).toBe('/tmp/project\u001fgithub')
    expect(connectionKey('  /tmp/project  ', 'github')).toBe('/tmp/project\u001fgithub')
  })

  it('defaults null, undefined, and blank scope to personal', () => {
    expect(connectionKey(null, 'brave')).toBe('personal\u001fbrave')
    expect(connectionKey(undefined, 'brave')).toBe('personal\u001fbrave')
    expect(connectionKey('   ', 'brave')).toBe('personal\u001fbrave')
    expect(connectionKey('personal', 'brave')).toBe('personal\u001fbrave')
  })
})
