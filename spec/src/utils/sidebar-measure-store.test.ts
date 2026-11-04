import { describe, expect, it } from 'vitest'
import {
  bindMeasuredRow,
  heightForKey,
  pruneMeasuredHeights,
  recordMeasuredHeight,
  unbindMeasuredRow,
} from '@/utils/sidebar-measure-store'

const estimate = 34

const measured = (
  ...entries: readonly (readonly [string, number])[]
): ReadonlyMap<string, number> => {
  let heights: ReadonlyMap<string, number> = new Map()
  for (const [key, height] of entries) {
    heights = recordMeasuredHeight(heights, key, height)
  }
  return heights
}

const heightsFor = (
  heights: ReadonlyMap<string, number>,
  keys: readonly string[],
): number[] => keys.map((key) => heightForKey(heights, key, estimate))

describe('sidebar-measure-store', () => {
  it('keeps heights attached to keys when rows reorder', () => {
    const heights = measured(['chat-a', 48], ['chat-b', 72], ['worktree-a', 120])

    expect(heightsFor(heights, ['worktree-a', 'chat-a', 'chat-b'])).toEqual([
      120, 48, 72,
    ])
  })

  it('does not shift heights onto other keys when a row is inserted at the head', () => {
    const heights = measured(['chat-a', 48], ['chat-b', 72])

    expect(heightsFor(heights, ['chat-c', 'chat-a', 'chat-b'])).toEqual([
      estimate, 48, 72,
    ])
  })

  it('drops removed keys and leaves the rest on their keys', () => {
    const heights = measured(['chat-a', 48], ['chat-b', 72], ['worktree-a', 120])
    const pruned = pruneMeasuredHeights(heights, ['worktree-a', 'chat-b'])

    expect(heightsFor(pruned, ['chat-a', 'chat-b', 'worktree-a'])).toEqual([
      estimate, 72, 120,
    ])
    expect([...pruned.keys()]).toEqual(['chat-b', 'worktree-a'])
  })

  it('falls back to the estimate when a key has not been measured', () => {
    expect(heightForKey(new Map(), 'chat-a', estimate)).toBe(estimate)
  })

  it('keeps the same map when every stored key is still present', () => {
    const heights = measured(['chat-a', 48], ['chat-b', 72])
    const empty = new Map<string, number>()

    expect(pruneMeasuredHeights(heights, ['chat-b', 'chat-c', 'chat-a'])).toBe(heights)
    expect(pruneMeasuredHeights(empty, [])).toBe(empty)
  })

  it('stores the ceiling of a fractional height and ignores a non-positive one', () => {
    const heights = recordMeasuredHeight(new Map(), 'chat-a', 40.2)

    expect(heightForKey(heights, 'chat-a', estimate)).toBe(41)
    expect(recordMeasuredHeight(heights, 'chat-a', 40.2)).toBe(heights)
    expect(recordMeasuredHeight(heights, 'chat-a', 0)).toBe(heights)
    expect(recordMeasuredHeight(heights, 'chat-b', -4)).toBe(heights)
  })

  it('rebinds a key without detaching a different row that is still rendered', () => {
    const keyToEl = new Map<string, string>()
    const elToKey = new Map<string, string>()

    expect(bindMeasuredRow(keyToEl, elToKey, 'chat-a', 'el-a')).toBeUndefined()
    expect(bindMeasuredRow(keyToEl, elToKey, 'chat-b', 'el-b')).toBeUndefined()
    expect(bindMeasuredRow(keyToEl, elToKey, 'chat-a', 'el-a')).toBeUndefined()
    expect(elToKey.get('el-a')).toBe('chat-a')
    expect(elToKey.get('el-b')).toBe('chat-b')

    expect(unbindMeasuredRow(keyToEl, elToKey, 'chat-a')).toBe('el-a')
    expect(keyToEl.has('chat-a')).toBe(false)
    expect(elToKey.has('el-a')).toBe(false)
    expect(keyToEl.get('chat-b')).toBe('el-b')
    expect(elToKey.get('el-b')).toBe('chat-b')
    expect(unbindMeasuredRow(keyToEl, elToKey, 'chat-a')).toBeUndefined()
  })

  it('does not detach an element that another key now owns', () => {
    const keyToEl = new Map<string, string>()
    const elToKey = new Map<string, string>()

    bindMeasuredRow(keyToEl, elToKey, 'chat-a', 'el-a')
    bindMeasuredRow(keyToEl, elToKey, 'chat-b', 'el-b')

    expect(bindMeasuredRow(keyToEl, elToKey, 'chat-b', 'el-a')).toBe('el-b')
    expect(keyToEl.has('chat-a')).toBe(false)
    expect(elToKey.get('el-a')).toBe('chat-b')
    expect(unbindMeasuredRow(keyToEl, elToKey, 'chat-a')).toBeUndefined()
    expect(keyToEl.get('chat-b')).toBe('el-a')
    expect(elToKey.get('el-a')).toBe('chat-b')
  })
})
