import { describe, expect, it } from 'vitest'
import type { FileDiff } from '@/types/harness/file-diff'
import {
  diffCounts,
  discardToolDiff,
  recordToolDiff,
  takeToolDiff,
} from '@/services/harness/shared/tool-diff-handoff'

const hunk = (lines: FileDiff['hunks'][number]['lines']): FileDiff['hunks'][number] => ({
  oldStart: 1,
  newStart: 1,
  lines,
})

describe('tool-diff-handoff', () => {
  it('takes recorded diffs once and clears the entry', () => {
    const diffs: FileDiff[] = [{ path: 'a.ts', operation: 'update', hunks: [] }]
    recordToolDiff('call-take', diffs)
    expect(takeToolDiff('call-take')).toEqual(diffs)
    expect(takeToolDiff('call-take')).toBeUndefined()
  })

  it('overwrites a repeated toolCallId record', () => {
    const first: FileDiff[] = [{ path: 'a.ts', operation: 'update', hunks: [] }]
    const second: FileDiff[] = [{ path: 'b.ts', operation: 'update', hunks: [] }]
    recordToolDiff('call-twice', first)
    recordToolDiff('call-twice', second)
    expect(takeToolDiff('call-twice')).toEqual(second)
  })

  it('discards pending diffs', () => {
    recordToolDiff('call-discard', [])
    discardToolDiff('call-discard')
    expect(takeToolDiff('call-discard')).toBeUndefined()
  })

  it('evicts the oldest entry beyond the tracking limit', () => {
    const keys: string[] = []
    for (let i = 0; i <= 512; i++) {
      const key = `evict-${i}`
      keys.push(key)
      recordToolDiff(key, [{ path: key, operation: 'update', hunks: [] }])
    }
    expect(takeToolDiff(keys[0]!)).toBeUndefined()
    expect(takeToolDiff(keys[512]!)).toBeDefined()
    for (const key of keys.slice(1)) {
      discardToolDiff(key)
    }
    discardToolDiff(keys[512]!)
  })
})

describe('diffCounts', () => {
  it('counts add/remove lines across hunks and ignores context lines', () => {
    const diffs: FileDiff[] = [
      {
        path: 'a.ts',
        operation: 'update',
        hunks: [
          hunk([
            { kind: 'context', content: 'same' },
            { kind: 'remove', content: 'old' },
            { kind: 'add', content: 'new' },
            { kind: 'add', content: 'new2' },
          ]),
          hunk([{ kind: 'remove', content: 'gone' }]),
        ],
      },
    ]
    expect(diffCounts(diffs)).toEqual({ added: 2, removed: 2 })
  })

  it('falls back to content line counts when a diff has no hunks', () => {
    const diffs: FileDiff[] = [
      {
        path: 'b.ts',
        operation: 'create',
        oldContent: 'x\ny\n',
        newContent: 'a\nb\nc',
        hunks: [],
      },
    ]
    expect(diffCounts(diffs)).toEqual({ added: 3, removed: 2 })
  })

  it('returns zeros for empty diffs and empty contents', () => {
    expect(diffCounts([])).toEqual({ added: 0, removed: 0 })
    expect(
      diffCounts([
        { path: 'c.ts', operation: 'delete', oldContent: '', newContent: '', hunks: [] },
      ]),
    ).toEqual({ added: 0, removed: 0 })
  })
})
