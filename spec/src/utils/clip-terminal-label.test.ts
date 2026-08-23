import { describe, expect, it } from 'vitest'
import { clipTerminalLabel } from '@/utils/clip-terminal-label'

describe('clipTerminalLabel', () => {
  it('collapses whitespace and keeps short titles', () => {
    expect(clipTerminalLabel('  Find Jellyfin  database  ')).toBe('Find Jellyfin database')
  })

  it('caps long titles at 48 characters', () => {
    const long = 'Query the local jellyfin sqlite catalog for movies and series counts'
    expect(clipTerminalLabel(long).length).toBeLessThanOrEqual(48)
    expect(clipTerminalLabel(long).endsWith('...')).toBe(true)
  })
})
