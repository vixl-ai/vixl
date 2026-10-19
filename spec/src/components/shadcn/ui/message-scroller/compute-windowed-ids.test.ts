import { describe, expect, it } from 'vitest'
import {
  computeWindowedIds,
  DEFAULT_ITEM_HEIGHT,
  estimateItemsHeight,
  FALLBACK_VIEWPORT_HEIGHT,
  resolveViewportHeight,
  shouldChaseFollowBottomOnResize,
  shouldEstimateFollowBottomScrollTop,
} from '@/components/shadcn/ui/message-scroller/compute-windowed-ids'

const ids = (...values: string[]): string[] => values

describe('computeWindowedIds', () => {
  it('mounts only items that intersect the viewport plus overscan', () => {
    const itemIds = ids('a', 'b', 'c', 'd', 'e', 'f')
    const heights = new Map(itemIds.map((id) => [id, 100]))
    const mounted = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 100,
      paddingStart: 0,
      scrollTop: 0,
      viewportHeight: 100,
    })

    expect([...mounted]).toEqual(['a', 'b', 'c'])
  })

  it('shifts the window when scrolled into later items', () => {
    const itemIds = ids('a', 'b', 'c', 'd', 'e', 'f')
    const heights = new Map(itemIds.map((id) => [id, 100]))
    const mounted = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 0,
      paddingStart: 0,
      scrollTop: 250,
      viewportHeight: 100,
    })

    expect([...mounted]).toEqual(['c', 'd'])
  })

  it('always includes pinned ids even when they are outside the window', () => {
    const itemIds = ids('a', 'b', 'c', 'd', 'e')
    const heights = new Map(itemIds.map((id) => [id, 100]))
    const mounted = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 0,
      pinnedIds: ['e'],
      scrollTop: 0,
      viewportHeight: 80,
    })

    expect(mounted.has('a')).toBe(true)
    expect(mounted.has('e')).toBe(true)
    expect(mounted.has('c')).toBe(false)
  })

  it('uses the default height when an item has not been measured', () => {
    const itemIds = ids('a', 'b')
    const mounted = computeWindowedIds({
      gap: 0,
      heights: new Map(),
      itemIds,
      overscanPx: 0,
      scrollTop: 0,
      viewportHeight: DEFAULT_ITEM_HEIGHT - 10,
    })

    expect([...mounted]).toEqual(['a'])
  })

  it('accounts for gap and padding when locating the window', () => {
    const itemIds = ids('a', 'b', 'c', 'd')
    const heights = new Map(itemIds.map((id) => [id, 100]))
    const mounted = computeWindowedIds({
      gap: 20,
      heights,
      itemIds,
      overscanPx: 0,
      paddingStart: 40,
      scrollTop: 0,
      viewportHeight: 50,
    })

    expect([...mounted]).toEqual(['a'])
  })
})

describe('resolveViewportHeight', () => {
  it('uses the live clientHeight when it is at least 1', () => {
    expect(resolveViewportHeight({
      clientHeight: 640,
      lastPositiveClientHeight: 800,
    })).toBe(640)
  })

  it('reuses the last positive height when the viewport measures 0', () => {
    expect(resolveViewportHeight({
      clientHeight: 0,
      lastPositiveClientHeight: 720,
    })).toBe(720)
  })

  it('uses FALLBACK_VIEWPORT_HEIGHT before any positive measurement', () => {
    expect(resolveViewportHeight({
      clientHeight: 0,
    })).toBe(FALLBACK_VIEWPORT_HEIGHT)
  })

  it('accepts a custom fallback for the pre-measure case', () => {
    expect(resolveViewportHeight({
      clientHeight: 0.4,
      fallbackHeight: 0,
      lastPositiveClientHeight: 0,
    })).toBe(0)
  })
})

describe('shouldChaseFollowBottomOnResize', () => {
  it('skips chase when clientHeight is below 1', () => {
    expect(shouldChaseFollowBottomOnResize({
      clientHeight: 0,
      maxScrollTop: 400,
      scrollEpsilon: 0.5,
      scrollTop: 0,
    })).toBe(false)
  })

  it('skips chase when already within epsilon of maxScrollTop', () => {
    expect(shouldChaseFollowBottomOnResize({
      clientHeight: 800,
      maxScrollTop: 400,
      scrollEpsilon: 0.5,
      scrollTop: 400.4,
    })).toBe(false)
  })

  it('chases when the viewport has height and is not at the bottom', () => {
    expect(shouldChaseFollowBottomOnResize({
      clientHeight: 800,
      maxScrollTop: 400,
      scrollEpsilon: 0.5,
      scrollTop: 399.4,
    })).toBe(true)
  })
})

describe('shouldEstimateFollowBottomScrollTop', () => {
  it('estimates the tail when following the bottom with a zero-height viewport', () => {
    expect(shouldEstimateFollowBottomScrollTop({
      clientHeight: 0,
      followingBottom: true,
    })).toBe(true)
  })

  it('uses the real scrollTop when the viewport has a positive height', () => {
    expect(shouldEstimateFollowBottomScrollTop({
      clientHeight: 800,
      followingBottom: true,
    })).toBe(false)
  })

  it('uses the real scrollTop when not following the bottom', () => {
    expect(shouldEstimateFollowBottomScrollTop({
      clientHeight: 0,
      followingBottom: false,
    })).toBe(false)
  })
})

describe('estimateItemsHeight', () => {
  it('sums measured heights, gaps, and padding', () => {
    const height = estimateItemsHeight({
      gap: 10,
      heights: new Map([
        ['a', 100],
        ['b', 50],
        ['c', 25],
      ]),
      itemIds: ids('a', 'b', 'c'),
      paddingEnd: 8,
      paddingStart: 8,
    })

    expect(height).toBe(8 + 8 + 100 + 50 + 25 + 10 + 10)
  })

  it('falls back to the default height for unmeasured items', () => {
    const height = estimateItemsHeight({
      defaultHeight: 40,
      gap: 0,
      heights: new Map(),
      itemIds: ids('a', 'b'),
      paddingEnd: 0,
      paddingStart: 0,
    })

    expect(height).toBe(80)
  })
})
