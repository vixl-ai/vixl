import { describe, expect, it } from 'vitest'
import groupMatches from '@/services/workspace-search/group-matches'
import type { GrepMatch } from '@/services/vixl/vixl-tauri'

const hit = (
  path: string,
  lineNumber: number,
  line: string,
  startColumn?: number,
  endColumn?: number,
): GrepMatch => ({
  path,
  lineNumber,
  line,
  startColumn,
  endColumn,
})

describe('groupMatches', () => {
  it('returns empty for empty matches', () => {
    expect(groupMatches([])).toEqual([])
  })

  it('groups many hits under one file in hit order', () => {
    const matches = [
      hit('src/a.ts', 1, 'foo', 1, 4),
      hit('src/a.ts', 3, 'bar', 1, 4),
      hit('src/a.ts', 3, 'bar', 5, 8),
    ]
    expect(groupMatches(matches)).toEqual([
      {
        path: 'src/a.ts',
        hits: matches,
      },
    ])
  })

  it('preserves first-seen file order across multiple files', () => {
    const matches = [
      hit('src/b.ts', 2, 'two'),
      hit('src/a.ts', 1, 'one'),
      hit('src/b.ts', 4, 'four'),
      hit('src/c.ts', 1, 'c'),
    ]
    const groups = groupMatches(matches)
    expect(groups.map((group) => group.path)).toEqual([
      'src/b.ts',
      'src/a.ts',
      'src/c.ts',
    ])
    expect(groups[0]?.hits).toEqual([matches[0], matches[2]])
    expect(groups[1]?.hits).toEqual([matches[1]])
    expect(groups[2]?.hits).toEqual([matches[3]])
  })

  it('keeps multiple hits on the same line as separate rows', () => {
    const matches = [
      hit('src/a.ts', 10, 'foo foo foo', 1, 4),
      hit('src/a.ts', 10, 'foo foo foo', 5, 8),
      hit('src/a.ts', 10, 'foo foo foo', 9, 12),
    ]
    const groups = groupMatches(matches)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.hits).toHaveLength(3)
    expect(groups[0]?.hits.map((row) => row.startColumn)).toEqual([1, 5, 9])
  })
})
