import { describe, expect, it } from 'vitest'
import {
  computeWindowedIds,
  DEFAULT_ITEM_HEIGHT,
  estimateItemsHeight,
  FALLBACK_VIEWPORT_HEIGHT,
  resolveViewportHeight,
  resolveWindowScrollTop,
  shouldAnchorOnContentChange,
  shouldChaseFollowBottomOnResize,
  shouldEstimateFollowBottomScrollTop,
  shouldExitFollowBottom,
  shouldSettleScrollToEnd,
  shouldTreatAnchorAsUnhandled,
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

describe('shouldSettleScrollToEnd', () => {
  const settled = {
    hasStreamingTurn: false,
    maxScrollTop: 400,
    mode: 'following-bottom',
    nextMode: 'following-bottom',
    scrollEpsilon: 0.5,
    scrollTop: 400,
    spacerHeight: 0,
  }

  it('settles when already at the destination with no spacer or streaming turn', () => {
    expect(shouldSettleScrollToEnd(settled)).toBe(true)
  })

  it('does not settle when a tail spacer is still in play', () => {
    expect(shouldSettleScrollToEnd({
      ...settled,
      spacerHeight: 240,
    })).toBe(false)
  })

  it('does not settle while a streaming turn is anchored', () => {
    expect(shouldSettleScrollToEnd({
      ...settled,
      hasStreamingTurn: true,
    })).toBe(false)
  })

  it('does not settle when the mode still needs to change', () => {
    expect(shouldSettleScrollToEnd({
      ...settled,
      mode: 'free-scrolling',
    })).toBe(false)
  })

  it('does not settle when scrollTop is beyond epsilon of maxScrollTop', () => {
    expect(shouldSettleScrollToEnd({
      ...settled,
      scrollTop: 399.4,
    })).toBe(false)
  })

  it('settles when scrollTop is within epsilon of maxScrollTop', () => {
    expect(shouldSettleScrollToEnd({
      ...settled,
      scrollTop: 399.6,
    })).toBe(true)
  })
})

describe('shouldAnchorOnContentChange', () => {
  it('keeps the keep-previous-peek path when the user is not following live', () => {
    expect(shouldAnchorOnContentChange({ followingLive: false })).toBe(true)
  })

  it('skips the anchored-to-message path while following live', () => {
    expect(shouldAnchorOnContentChange({ followingLive: true })).toBe(false)
  })
})

describe('shouldTreatAnchorAsUnhandled', () => {
  it('treats a remounted element with the same messageId as already handled', () => {
    expect(shouldTreatAnchorAsUnhandled({
      handledMessageIds: new Set(['t1']),
      messageId: 't1',
    })).toBe(false)
  })

  it('treats a new messageId as unhandled', () => {
    expect(shouldTreatAnchorAsUnhandled({
      handledMessageIds: new Set(['t1']),
      messageId: 't2',
    })).toBe(true)
  })

  it('treats a missing messageId as unhandled', () => {
    expect(shouldTreatAnchorAsUnhandled({
      handledMessageIds: new Set(['t1']),
      messageId: undefined,
    })).toBe(true)
  })
})

describe('resolveWindowScrollTop', () => {
  it('subtracts the tail spacer when following the bottom', () => {
    expect(resolveWindowScrollTop({
      followingBottom: true,
      scrollTop: 800,
      spacerHeight: 400,
    })).toBe(400)
  })

  it('subtracts the tail spacer even when not following if a spacer is present', () => {
    expect(resolveWindowScrollTop({
      followingBottom: false,
      scrollTop: 500,
      spacerHeight: 120,
    })).toBe(380)
  })

  it('leaves scrollTop unchanged when not following and there is no spacer', () => {
    expect(resolveWindowScrollTop({
      followingBottom: false,
      scrollTop: 250,
      spacerHeight: 0,
    })).toBe(250)
  })

  it('does not drop below zero', () => {
    expect(resolveWindowScrollTop({
      followingBottom: true,
      scrollTop: 40,
      spacerHeight: 80,
    })).toBe(0)
  })

  it('does not collapse the window to pinned ids when spacer inflates scrollTop', () => {
    const itemIds = ids('a', 'b', 'c', 'd', 'e', 'f')
    const heights = new Map(itemIds.map((id) => [id, 100]))
    const inflatedScrollTop = 800
    const spacerHeight = 400
    const viewportHeight = 200
    const inflated = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 0,
      pinnedIds: ['f'],
      scrollTop: inflatedScrollTop,
      viewportHeight,
    })
    const adjusted = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 0,
      pinnedIds: ['f'],
      scrollTop: resolveWindowScrollTop({
        followingBottom: true,
        scrollTop: inflatedScrollTop,
        spacerHeight,
      }),
      viewportHeight,
    })

    expect([...inflated]).toEqual(['f'])
    expect([...adjusted]).toEqual(['d', 'e', 'f'])
  })
})

describe('shouldExitFollowBottom', () => {
  const exiting = {
    autoscrolling: false,
    distanceFromEnd: 24,
    scrolledUp: true,
    threshold: 8,
  }

  it('keeps follow when distance from end is within the threshold', () => {
    expect(shouldExitFollowBottom({
      ...exiting,
      distanceFromEnd: 8,
    })).toBe(false)
  })

  it('exits follow when the user has scrolled past the threshold', () => {
    expect(shouldExitFollowBottom(exiting)).toBe(true)
  })

  it('keeps follow while autoscrolling even if distance exceeds the threshold', () => {
    expect(shouldExitFollowBottom({
      ...exiting,
      autoscrolling: true,
    })).toBe(false)
  })

  it('keeps follow when the last scroll was not up', () => {
    expect(shouldExitFollowBottom({
      ...exiting,
      scrolledUp: false,
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
