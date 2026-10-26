import { describe, expect, it } from 'vitest'
import {
  clampReadingWindowScrollTop,
  computeWindowedIds,
  DEFAULT_ITEM_HEIGHT,
  estimateItemsHeight,
  extraNonWindowedChildrenHeight,
  FALLBACK_VIEWPORT_HEIGHT,
  resolveFollowWindowScrollTop,
  resolveViewportHeight,
  resolveWindowScrollTop,
  shouldStickContentChangeToEnd,
  wasReaderAtLiveEdge,
  shouldAdvanceFollowChaseBaseline,
  shouldChaseFollowBottom,
  shouldChaseFollowBottomOnContentGrowth,
  shouldChaseFollowBottomOnResize,
  shouldChaseFollowBottomOnSizeChange,
  shouldChaseFollowOnViewportResize,
  shouldTrustFollowBottomContentMeasurements,
  shouldEstimateFollowBottomScrollTop,
  shouldInvalidateItemHeightsOnWidthChange,
  shouldSampleClientWidthBaseline,
  shouldExitFollowBottom,
  shouldExitFollowBottomOnUnarmedScroll,
  shouldExitFollowBottomOnUserTouch,
  shouldRecoverFollowAfterLayoutScroll,
  shouldTreatUpwardScrollAsLayoutClamp,
  shouldSettleScrollToEnd,
  shouldTreatAnchorAsUnhandled,
  isNestedOverflowY,
  createResizePendingState,
  nextResizePendingOnFrame,
  nextResizePendingOnMark,
  nextUpwardWheelAccumulator,
  normalizeWheelDeltaY,
  shouldAddToUpwardWheelAccumulator,
  shouldArmUpwardWheelGesture,
  shouldPromoteNestedWheelToGesture,
  wheelPathHasNestedOverflowScroller,
  WHEEL_DELTA_LINE,
  WHEEL_DELTA_PAGE,
  WHEEL_DELTA_PIXEL,
  WHEEL_LINE_HEIGHT_PX,
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

describe('shouldChaseFollowBottomOnContentGrowth', () => {
  it('chases when scrollHeight grew beyond epsilon', () => {
    expect(shouldChaseFollowBottomOnContentGrowth({
      previousScrollHeight: 1000,
      scrollEpsilon: 0.5,
      scrollHeight: 1000.6,
    })).toBe(true)
  })

  it('skips chase when scrollHeight is unchanged', () => {
    expect(shouldChaseFollowBottomOnContentGrowth({
      previousScrollHeight: 1000,
      scrollEpsilon: 0.5,
      scrollHeight: 1000,
    })).toBe(false)
  })

  it('skips chase when growth is within epsilon', () => {
    expect(shouldChaseFollowBottomOnContentGrowth({
      previousScrollHeight: 1000,
      scrollEpsilon: 0.5,
      scrollHeight: 1000.4,
    })).toBe(false)
  })

  it('skips chase when scrollHeight shrank', () => {
    expect(shouldChaseFollowBottomOnContentGrowth({
      previousScrollHeight: 1400,
      scrollEpsilon: 0.5,
      scrollHeight: 1000,
    })).toBe(false)
  })
})

describe('shouldChaseFollowBottomOnSizeChange', () => {
  it('chases when scrollHeight grew beyond epsilon', () => {
    expect(shouldChaseFollowBottomOnSizeChange({
      previousScrollHeight: 1000,
      scrollEpsilon: 0.5,
      scrollHeight: 1000.6,
    })).toBe(true)
  })

  it('chases when scrollHeight shrank beyond epsilon', () => {
    expect(shouldChaseFollowBottomOnSizeChange({
      previousScrollHeight: 1400,
      scrollEpsilon: 0.5,
      scrollHeight: 1000,
    })).toBe(true)
  })

  it('skips chase when scrollHeight is unchanged', () => {
    expect(shouldChaseFollowBottomOnSizeChange({
      previousScrollHeight: 1000,
      scrollEpsilon: 0.5,
      scrollHeight: 1000,
    })).toBe(false)
  })

  it('skips chase when growth is within epsilon', () => {
    expect(shouldChaseFollowBottomOnSizeChange({
      previousScrollHeight: 1000,
      scrollEpsilon: 0.5,
      scrollHeight: 1000.4,
    })).toBe(false)
  })

  it('skips chase when shrink is within epsilon', () => {
    expect(shouldChaseFollowBottomOnSizeChange({
      previousScrollHeight: 1000,
      scrollEpsilon: 0.5,
      scrollHeight: 999.6,
    })).toBe(false)
  })
})

describe('shouldChaseFollowBottom', () => {
  it('chases whenever the reader is off the live edge', () => {
    expect(shouldChaseFollowBottom({ offEnd: true })).toBe(true)
  })

  it('stays put when the reader is already at the live edge', () => {
    expect(shouldChaseFollowBottom({ offEnd: false })).toBe(false)
  })
})

describe('shouldChaseFollowOnViewportResize', () => {
  it('chases when off the end and measurements are trusted', () => {
    expect(shouldChaseFollowOnViewportResize({
      offEnd: true,
      trust: true,
    })).toBe(true)
  })

  it('skips chase when measurements are not trusted', () => {
    expect(shouldChaseFollowOnViewportResize({
      offEnd: true,
      trust: false,
    })).toBe(false)
  })

  it('skips chase when already at the end', () => {
    expect(shouldChaseFollowOnViewportResize({
      offEnd: false,
      trust: true,
    })).toBe(false)
  })
})

describe('extraNonWindowedChildrenHeight', () => {
  it('adds extra child height plus one row gap when windowed items exist', () => {
    expect(extraNonWindowedChildrenHeight({
      children: [
        { height: 180, messageId: '0' },
        { height: 96 },
      ],
      gap: 24,
      windowItemIds: new Set(['0']),
    })).toBe(120)
  })

  it('adds a gap between two extra children after windowed items', () => {
    expect(extraNonWindowedChildrenHeight({
      children: [
        { height: 180, messageId: '0' },
        { height: 96 },
        { height: 48 },
      ],
      gap: 24,
      windowItemIds: new Set(['0']),
    })).toBe(192)
  })

  it('uses extraCount minus one gaps when no windowed items are present', () => {
    expect(extraNonWindowedChildrenHeight({
      children: [
        { height: 96 },
        { height: 48 },
      ],
      gap: 24,
      windowItemIds: new Set(),
    })).toBe(168)
  })

  it('ignores live-activity when it is in windowItemIds', () => {
    expect(extraNonWindowedChildrenHeight({
      children: [
        { height: 180, messageId: '0' },
        { height: 20, messageId: 'live-activity' },
        { height: 96 },
      ],
      gap: 24,
      windowItemIds: new Set(['0', 'live-activity']),
    })).toBe(120)
  })

  it('returns 0 when every child is windowed', () => {
    expect(extraNonWindowedChildrenHeight({
      children: [
        { height: 180, messageId: '0' },
        { height: 20, messageId: 'live-activity' },
      ],
      gap: 24,
      windowItemIds: new Set(['0', 'live-activity']),
    })).toBe(0)
  })
})

describe('shouldTrustFollowBottomContentMeasurements', () => {
  it('trusts when estimated height matches the DOM within epsilon', () => {
    expect(shouldTrustFollowBottomContentMeasurements({
      estimatedHeight: 1400.4,
      scrollEpsilon: 0.5,
      scrollHeight: 1400,
    })).toBe(true)
  })

  it('rejects when mounted content is taller than the height map', () => {
    expect(shouldTrustFollowBottomContentMeasurements({
      estimatedHeight: 1600,
      scrollEpsilon: 0.5,
      scrollHeight: 3200,
    })).toBe(false)
  })

  it('trusts when extra non-windowed children are counted on the estimate', () => {
    const estimatedHeight = estimateItemsHeight({
      gap: 24,
      heights: new Map([['0', 180]]),
      itemIds: ['0'],
    })
    const extraChildrenHeight = extraNonWindowedChildrenHeight({
      children: [
        { height: 180, messageId: '0' },
        { height: 96 },
      ],
      gap: 24,
      windowItemIds: new Set(['0']),
    })
    const scrollHeight = estimatedHeight + extraChildrenHeight
    expect(shouldTrustFollowBottomContentMeasurements({
      estimatedHeight,
      extraChildrenHeight: 0,
      scrollEpsilon: 0.5,
      scrollHeight,
    })).toBe(false)
    expect(shouldTrustFollowBottomContentMeasurements({
      estimatedHeight,
      extraChildrenHeight,
      scrollEpsilon: 0.5,
      scrollHeight,
    })).toBe(true)
  })

  it('trusts accumulated rounding drift within 0.5px per measured item', () => {
    const measuredCount = 10
    const rounded = 332
    const fractional = 332.4
    expect(shouldTrustFollowBottomContentMeasurements({
      estimatedHeight: rounded * measuredCount,
      measuredCount,
      scrollEpsilon: 0.5,
      scrollHeight: fractional * measuredCount,
    })).toBe(true)
  })

  it('rejects rounding drift when measuredCount is omitted', () => {
    const measuredCount = 10
    const rounded = 332
    const fractional = 332.4
    expect(shouldTrustFollowBottomContentMeasurements({
      estimatedHeight: rounded * measuredCount,
      scrollEpsilon: 0.5,
      scrollHeight: fractional * measuredCount,
    })).toBe(false)
  })

  it('rejects a stale-height pump even with scaled rounding tolerance', () => {
    const measuredCount = 14
    const perItemMismatch = 100
    const estimatedHeight = measuredCount * DEFAULT_ITEM_HEIGHT
    expect(shouldTrustFollowBottomContentMeasurements({
      estimatedHeight,
      measuredCount,
      scrollEpsilon: 0.5,
      scrollHeight: estimatedHeight + perItemMismatch * measuredCount,
    })).toBe(false)
  })
})

describe('shouldAdvanceFollowChaseBaseline', () => {
  it('advances when the chase fired', () => {
    expect(shouldAdvanceFollowChaseBaseline({
      chased: true,
      trust: false,
    })).toBe(true)
  })

  it('advances when estimates were consistent with the DOM', () => {
    expect(shouldAdvanceFollowChaseBaseline({
      chased: false,
      trust: true,
    })).toBe(true)
  })

  it('keeps the growth baseline on a trust-blocked frame', () => {
    expect(shouldAdvanceFollowChaseBaseline({
      chased: false,
      trust: false,
    })).toBe(false)
  })
})

describe('shouldInvalidateItemHeightsOnWidthChange', () => {
  it('skips the first positive width observation', () => {
    expect(shouldInvalidateItemHeightsOnWidthChange({
      clientHeight: 800,
      clientWidth: 640,
      lastClientWidth: 0,
    })).toBe(false)
  })

  it('skips a sub-1 lastClientWidth as an unmeasured first sample', () => {
    expect(shouldInvalidateItemHeightsOnWidthChange({
      clientHeight: 800,
      clientWidth: 640,
      lastClientWidth: 0.4,
    })).toBe(false)
  })

  it('skips when clientWidth is below 1', () => {
    expect(shouldInvalidateItemHeightsOnWidthChange({
      clientHeight: 800,
      clientWidth: 0,
      lastClientWidth: 720,
    })).toBe(false)
  })

  it('skips when the viewport has no usable height (estimate path)', () => {
    expect(shouldInvalidateItemHeightsOnWidthChange({
      clientHeight: 0,
      clientWidth: 640,
      lastClientWidth: 720,
    })).toBe(false)
  })

  it('skips when clientHeight is positive but still below 1', () => {
    expect(shouldInvalidateItemHeightsOnWidthChange({
      clientHeight: 0.4,
      clientWidth: 640,
      lastClientWidth: 720,
    })).toBe(false)
  })

  it('skips subpixel jitter at the same CSS pixel width', () => {
    expect(shouldInvalidateItemHeightsOnWidthChange({
      clientHeight: 800,
      clientWidth: 640.4,
      lastClientWidth: 640.1,
    })).toBe(false)
  })

  it('does not invalidate when rounded CSS pixel widths differ', () => {
    expect(shouldInvalidateItemHeightsOnWidthChange({
      clientHeight: 800,
      clientWidth: 640.6,
      lastClientWidth: 640.4,
    })).toBe(false)
  })

  it('does not invalidate when integer CSS pixel width is unchanged', () => {
    expect(shouldInvalidateItemHeightsOnWidthChange({
      clientHeight: 800,
      clientWidth: 640,
      lastClientWidth: 640,
    })).toBe(false)
  })

  it('does not invalidate when the viewport width changes after a prior measure', () => {
    expect(shouldInvalidateItemHeightsOnWidthChange({
      clientHeight: 800,
      clientWidth: 480,
      lastClientWidth: 640,
    })).toBe(false)
  })
})

describe('shouldSampleClientWidthBaseline', () => {
  it('samples when the viewport has usable width and height', () => {
    expect(shouldSampleClientWidthBaseline({
      clientHeight: 800,
      clientWidth: 640,
    })).toBe(true)
  })

  it('skips when the viewport has no usable height', () => {
    expect(shouldSampleClientWidthBaseline({
      clientHeight: 0,
      clientWidth: 480,
    })).toBe(false)
  })

  it('skips when clientHeight is positive but still below 1', () => {
    expect(shouldSampleClientWidthBaseline({
      clientHeight: 0.4,
      clientWidth: 480,
    })).toBe(false)
  })

  it('skips when clientWidth is below 1', () => {
    expect(shouldSampleClientWidthBaseline({
      clientHeight: 800,
      clientWidth: 0,
    })).toBe(false)
  })

  it('skips a sub-1 clientWidth as an unmeasured first sample', () => {
    expect(shouldSampleClientWidthBaseline({
      clientHeight: 800,
      clientWidth: 0.4,
    })).toBe(false)
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

describe('shouldStickContentChangeToEnd', () => {
  it('sticks while following live', () => {
    expect(shouldStickContentChangeToEnd({
      atLiveEdge: false,
      followingLive: true,
    })).toBe(true)
  })

  it('sticks when follow mode was dropped but the viewport is still on the live edge', () => {
    expect(shouldStickContentChangeToEnd({
      atLiveEdge: true,
      followingLive: false,
    })).toBe(true)
  })

  it('leaves a reader who scrolled away from the live edge where they are', () => {
    expect(shouldStickContentChangeToEnd({
      atLiveEdge: false,
      followingLive: false,
    })).toBe(false)
  })
})

describe('wasReaderAtLiveEdge', () => {
  it('is true when the viewport bottom still reaches the previous end', () => {
    expect(wasReaderAtLiveEdge({
      previousEnd: 1000,
      scrollTop: 600,
      threshold: 8,
      viewportHeight: 400,
    })).toBe(true)
  })

  it('is false after the reader scrolls above the previous end', () => {
    expect(wasReaderAtLiveEdge({
      previousEnd: 1000,
      scrollTop: 500,
      threshold: 8,
      viewportHeight: 400,
    })).toBe(false)
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

describe('resolveFollowWindowScrollTop', () => {
  it('pins the window to the cached document end', () => {
    expect(resolveFollowWindowScrollTop({
      estimatedHeight: 1400,
      viewportHeight: 400,
    })).toBe(1000)
  })

  it('does not drop below zero when the cache is shorter than the viewport', () => {
    expect(resolveFollowWindowScrollTop({
      estimatedHeight: 200,
      viewportHeight: 400,
    })).toBe(0)
  })

  it('does not collapse the window when live scrollTop is past the cache', () => {
    const itemIds = ids('a', 'b', 'c', 'd', 'e', 'f')
    const heights = new Map(itemIds.map((id) => [id, 100]))
    const estimatedHeight = estimateItemsHeight({
      gap: 0,
      heights,
      itemIds,
    })
    const viewportHeight = 200
    const liveScrollTop = 2000
    const collapsed = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 0,
      pinnedIds: ['f'],
      scrollTop: liveScrollTop,
      viewportHeight,
    })
    const followed = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 0,
      pinnedIds: ['f'],
      scrollTop: resolveFollowWindowScrollTop({
        estimatedHeight,
        viewportHeight,
      }),
      viewportHeight,
    })

    expect([...collapsed]).toEqual(['f'])
    expect([...followed]).toEqual(['d', 'e', 'f'])
  })
})

describe('clampReadingWindowScrollTop', () => {
  it('passes through a scrollTop inside the cached document', () => {
    expect(clampReadingWindowScrollTop({
      estimatedHeight: 1400,
      scrollTop: 400,
      viewportHeight: 400,
    })).toBe(400)
  })

  it('clamps a DOM scrollTop past the cache to the cached end', () => {
    expect(clampReadingWindowScrollTop({
      estimatedHeight: 800,
      scrollTop: 2000,
      viewportHeight: 400,
    })).toBe(400)
  })

  it('does not drop below zero', () => {
    expect(clampReadingWindowScrollTop({
      estimatedHeight: 800,
      scrollTop: -20,
      viewportHeight: 400,
    })).toBe(0)
  })

  it('clamps to zero when the cache is shorter than the viewport', () => {
    expect(clampReadingWindowScrollTop({
      estimatedHeight: 200,
      scrollTop: 80,
      viewportHeight: 400,
    })).toBe(0)
  })
})

describe('shouldExitFollowBottom', () => {
  const exiting = {
    autoscrolling: false,
    distanceFromEnd: 24,
    scrolledUp: true,
    threshold: 8,
    userGesture: true,
  }

  it('keeps follow when distance from end is within the threshold', () => {
    expect(shouldExitFollowBottom({
      ...exiting,
      distanceFromEnd: 8,
    })).toBe(false)
  })

  it('exits follow when a reader gesture scrolled up past the threshold', () => {
    expect(shouldExitFollowBottom(exiting)).toBe(true)
  })

  it('keeps follow when scrollTop moved up without a reader gesture', () => {
    expect(shouldExitFollowBottom({
      ...exiting,
      userGesture: false,
    })).toBe(false)
  })

  it('exits follow when a reader gesture scrolled up past the threshold even while autoscrolling', () => {
    expect(shouldExitFollowBottom({
      ...exiting,
      autoscrolling: true,
    })).toBe(true)
  })

  it('keeps follow when a layout write moved scrollTop', () => {
    expect(shouldExitFollowBottom({
      ...exiting,
      programmatic: true,
    })).toBe(false)
  })

  it('keeps follow when the last scroll was not up', () => {
    expect(shouldExitFollowBottom({
      ...exiting,
      scrolledUp: false,
    })).toBe(false)
  })
})

describe('shouldRecoverFollowAfterLayoutScroll', () => {
  const recovering = {
    distanceFromEnd: 24,
    followingBottom: true,
    layoutClamp: true,
    resizePending: false,
    scrolledUp: true,
    scrollHeightChanged: false,
    threshold: 8,
    userGesture: false,
  }

  it('recovers follow when layout moved scrollTop off the live edge', () => {
    expect(shouldRecoverFollowAfterLayoutScroll(recovering)).toBe(true)
  })

  it('does not recover when the upward scroll is not a layout clamp', () => {
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...recovering,
      layoutClamp: false,
    })).toBe(false)
  })

  it('does not recover when the reader is not following', () => {
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...recovering,
      followingBottom: false,
    })).toBe(false)
  })

  it('does not recover when a reader gesture is armed', () => {
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...recovering,
      userGesture: true,
    })).toBe(false)
  })

  it('does not recover when the write is already programmatic', () => {
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...recovering,
      programmatic: true,
    })).toBe(false)
  })

  it('does not recover when scrollTop did not move up', () => {
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...recovering,
      scrolledUp: false,
    })).toBe(false)
  })

  it('does not recover when the viewport is still within the edge threshold', () => {
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...recovering,
      distanceFromEnd: 8,
    })).toBe(false)
  })
})

describe('shouldExitFollowBottomOnUnarmedScroll', () => {
  const exiting = {
    distanceFromEnd: 24,
    layoutClamp: false,
    resizePending: false,
    scrolledUp: true,
    scrollHeightChanged: false,
    threshold: 8,
    userGesture: false,
  }

  it('exits follow when an unarmed reader scroll moves off the live edge', () => {
    expect(shouldExitFollowBottomOnUnarmedScroll(exiting)).toBe(true)
  })

  it('keeps follow when the upward scroll is a layout clamp', () => {
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...exiting,
      layoutClamp: true,
    })).toBe(false)
  })

  it('keeps follow when a reader gesture is armed', () => {
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...exiting,
      userGesture: true,
    })).toBe(false)
  })

  it('keeps follow when the write is already programmatic', () => {
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...exiting,
      programmatic: true,
    })).toBe(false)
  })

  it('keeps follow when scrollTop did not move up', () => {
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...exiting,
      scrolledUp: false,
    })).toBe(false)
  })

  it('keeps follow when the viewport is still within the edge threshold', () => {
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...exiting,
      distanceFromEnd: 8,
    })).toBe(false)
  })
})

describe('follow exit during height change', () => {
  const offEnd = {
    distanceFromEnd: 24,
    followingBottom: true,
    layoutClamp: false,
    programmatic: false,
    scrolledUp: true,
    threshold: 8,
  } as const

  it('stays in follow and recovers when unarmed scrollTop drops while scrollHeight grew', () => {
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...offEnd,
      resizePending: false,
      scrollHeightChanged: true,
      userGesture: false,
    })).toBe(false)
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...offEnd,
      resizePending: false,
      scrollHeightChanged: true,
      userGesture: false,
    })).toBe(true)
  })

  it('stays in follow and recovers when unarmed scrollTop drops while a resize is in flight', () => {
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...offEnd,
      resizePending: true,
      scrollHeightChanged: false,
      userGesture: false,
    })).toBe(false)
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...offEnd,
      resizePending: true,
      scrollHeightChanged: false,
      userGesture: false,
    })).toBe(true)
  })

  it('exits follow and does not recover for an upward reader gesture while height is changing', () => {
    expect(shouldExitFollowBottom({
      autoscrolling: false,
      distanceFromEnd: offEnd.distanceFromEnd,
      programmatic: false,
      scrolledUp: true,
      threshold: offEnd.threshold,
      userGesture: true,
    })).toBe(true)
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...offEnd,
      resizePending: false,
      scrollHeightChanged: true,
      userGesture: true,
    })).toBe(false)
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...offEnd,
      resizePending: false,
      scrollHeightChanged: true,
      userGesture: true,
    })).toBe(false)
  })

  it('exits follow and does not recover for an unarmed upward scroll with stable height', () => {
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...offEnd,
      resizePending: false,
      scrollHeightChanged: false,
      userGesture: false,
    })).toBe(true)
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...offEnd,
      resizePending: false,
      scrollHeightChanged: false,
      userGesture: false,
    })).toBe(false)
  })
})

describe('resizePending lifetime', () => {
  const offEnd = {
    distanceFromEnd: 24,
    followingBottom: true,
    layoutClamp: false,
    programmatic: false,
    scrolledUp: true,
    threshold: 8,
    userGesture: false,
  } as const

  it('stays pending on the frame after a resize', () => {
    let state = createResizePendingState()
    state = nextResizePendingOnMark(state)
    state = nextResizePendingOnFrame(state)
    expect(state.pending).toBe(true)
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...offEnd,
      resizePending: state.pending,
      scrollHeightChanged: false,
    })).toBe(false)
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...offEnd,
      resizePending: state.pending,
      scrollHeightChanged: false,
    })).toBe(true)
  })

  it('clears only after a frame with no resize', () => {
    let state = createResizePendingState()
    state = nextResizePendingOnMark(state)
    state = nextResizePendingOnFrame(state)
    expect(state.pending).toBe(true)
    state = nextResizePendingOnFrame(state)
    expect(state.pending).toBe(false)
    expect(shouldExitFollowBottomOnUnarmedScroll({
      ...offEnd,
      resizePending: state.pending,
      scrollHeightChanged: false,
    })).toBe(true)
    expect(shouldRecoverFollowAfterLayoutScroll({
      ...offEnd,
      resizePending: state.pending,
      scrollHeightChanged: false,
    })).toBe(false)
  })

  it('stays pending across consecutive resize frames', () => {
    let state = createResizePendingState()
    for (let frame = 0; frame < 6; frame += 1) {
      state = nextResizePendingOnMark(state)
      expect(state.pending).toBe(true)
      state = nextResizePendingOnFrame(state)
      expect(state.pending).toBe(true)
      expect(shouldExitFollowBottomOnUnarmedScroll({
        ...offEnd,
        resizePending: state.pending,
        scrollHeightChanged: false,
      })).toBe(false)
    }
  })
})

describe('shouldTreatUpwardScrollAsLayoutClamp', () => {
  const threshold = 8

  it('treats an upward drop within the shrink plus threshold as a layout clamp', () => {
    expect(shouldTreatUpwardScrollAsLayoutClamp({
      scrollHeightDelta: 40,
      scrollTopDelta: 40,
      threshold,
    })).toBe(true)
  })

  it('treats an upward drop equal to shrink plus threshold as a layout clamp', () => {
    expect(shouldTreatUpwardScrollAsLayoutClamp({
      scrollHeightDelta: 40,
      scrollTopDelta: 48,
      threshold,
    })).toBe(true)
  })

  it('does not treat a larger upward drop than shrink plus threshold as a layout clamp', () => {
    expect(shouldTreatUpwardScrollAsLayoutClamp({
      scrollHeightDelta: 40,
      scrollTopDelta: 49,
      threshold,
    })).toBe(false)
  })

  it('does not treat an upward scroll with stable height as a layout clamp', () => {
    expect(shouldTreatUpwardScrollAsLayoutClamp({
      scrollHeightDelta: 0,
      scrollTopDelta: 24,
      threshold,
    })).toBe(false)
  })

  it('does not treat an upward scroll with grown height as a layout clamp', () => {
    expect(shouldTreatUpwardScrollAsLayoutClamp({
      scrollHeightDelta: -20,
      scrollTopDelta: 24,
      threshold,
    })).toBe(false)
  })

  it('does not treat a downward or unchanged scrollTop as a layout clamp', () => {
    expect(shouldTreatUpwardScrollAsLayoutClamp({
      scrollHeightDelta: 40,
      scrollTopDelta: 0,
      threshold,
    })).toBe(false)
    expect(shouldTreatUpwardScrollAsLayoutClamp({
      scrollHeightDelta: 40,
      scrollTopDelta: -10,
      threshold,
    })).toBe(false)
  })
})

describe('shouldExitFollowBottomOnUserTouch', () => {
  const exiting = {
    distanceFromEnd: 24,
    pendingUserTouchScroll: true,
    scrolledUp: true,
    threshold: 8,
  }

  it('exits follow when a touch drag moved upward past the threshold', () => {
    expect(shouldExitFollowBottomOnUserTouch(exiting)).toBe(true)
  })

  it('keeps follow when no user touch is pending, including autoscroll clamps', () => {
    expect(shouldExitFollowBottomOnUserTouch({
      ...exiting,
      pendingUserTouchScroll: false,
    })).toBe(false)
  })

  it('keeps follow when the touch did not move scroll upward', () => {
    expect(shouldExitFollowBottomOnUserTouch({
      ...exiting,
      scrolledUp: false,
    })).toBe(false)
  })

  it('keeps follow when the touch stayed within the edge threshold', () => {
    expect(shouldExitFollowBottomOnUserTouch({
      ...exiting,
      distanceFromEnd: 8,
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

describe('normalizeWheelDeltaY', () => {
  it('keeps pixel deltas in pixels', () => {
    expect(normalizeWheelDeltaY({
      deltaMode: WHEEL_DELTA_PIXEL,
      deltaY: -12,
      viewportClientHeight: 400,
    })).toBe(-12)
  })

  it('treats one line as 16px', () => {
    expect(normalizeWheelDeltaY({
      deltaMode: WHEEL_DELTA_LINE,
      deltaY: -1,
      viewportClientHeight: 400,
    })).toBe(-WHEEL_LINE_HEIGHT_PX)
  })

  it('treats one page as the viewport clientHeight', () => {
    expect(normalizeWheelDeltaY({
      deltaMode: WHEEL_DELTA_PAGE,
      deltaY: -1,
      viewportClientHeight: 480,
    })).toBe(-480)
  })
})

describe('upward wheel accumulation', () => {
  const threshold = 8

  it('adds the magnitude of negative deltaY toward older messages', () => {
    expect(shouldAddToUpwardWheelAccumulator(-5)).toBe(true)
    expect(nextUpwardWheelAccumulator(0, -5)).toBe(5)
  })

  it('does not add positive or horizontal deltas to the upward accumulator', () => {
    expect(shouldAddToUpwardWheelAccumulator(6)).toBe(false)
    expect(shouldAddToUpwardWheelAccumulator(0)).toBe(false)
    expect(nextUpwardWheelAccumulator(0, 6)).toBe(0)
    expect(nextUpwardWheelAccumulator(4, 0)).toBe(4)
  })

  it('subtracts downward deltaY so jitter cancels and never goes below zero', () => {
    expect(nextUpwardWheelAccumulator(5, 3)).toBe(2)
    expect(nextUpwardWheelAccumulator(2, 10)).toBe(0)
  })

  it('arms only after accumulated upward distance passes the edge threshold', () => {
    const afterNoise = nextUpwardWheelAccumulator(0, -8)
    expect(shouldArmUpwardWheelGesture({
      accumulatedUpwardPx: afterNoise,
      threshold,
    })).toBe(false)
    const afterUp = nextUpwardWheelAccumulator(afterNoise, -1)
    expect(shouldArmUpwardWheelGesture({
      accumulatedUpwardPx: afterUp,
      threshold,
    })).toBe(true)
  })

  it('does not arm from downward wheels even when they follow a partial upward move', () => {
    const afterUp = nextUpwardWheelAccumulator(0, -6)
    const afterDown = nextUpwardWheelAccumulator(afterUp, 2)
    expect(shouldArmUpwardWheelGesture({
      accumulatedUpwardPx: afterDown,
      threshold,
    })).toBe(false)
  })
})

describe('nested overflow wheel targeting', () => {
  it('treats auto, scroll, and overlay as nested overflow scrollers', () => {
    expect(isNestedOverflowY('auto')).toBe(true)
    expect(isNestedOverflowY('scroll')).toBe(true)
    expect(isNestedOverflowY('overlay')).toBe(true)
  })

  it('does not treat visible, hidden, or clip as nested overflow scrollers', () => {
    expect(isNestedOverflowY('visible')).toBe(false)
    expect(isNestedOverflowY('hidden')).toBe(false)
    expect(isNestedOverflowY('clip')).toBe(false)
  })

  it('detects a nested scroller between the target and the viewport', () => {
    expect(wheelPathHasNestedOverflowScroller(['visible', 'auto', 'visible'])).toBe(true)
    expect(wheelPathHasNestedOverflowScroller(['visible', 'hidden'])).toBe(false)
    expect(wheelPathHasNestedOverflowScroller([])).toBe(false)
  })
})

describe('shouldPromoteNestedWheelToGesture', () => {
  const promoting = {
    accumulatedUpwardPx: 12,
    nestedWheelPending: true,
    programmatic: false,
    scrolledUp: true,
    threshold: 8,
  }

  it('promotes when nested upward accumulation passed the threshold and scrollTop moved up', () => {
    expect(shouldPromoteNestedWheelToGesture(promoting)).toBe(true)
  })

  it('does not promote from the nested wheel event itself without an upward viewport move', () => {
    expect(shouldPromoteNestedWheelToGesture({
      ...promoting,
      scrolledUp: false,
    })).toBe(false)
  })

  it('does not promote when nested accumulation has not passed the threshold', () => {
    expect(shouldPromoteNestedWheelToGesture({
      ...promoting,
      accumulatedUpwardPx: 8,
    })).toBe(false)
  })

  it('does not promote when no nested wheel is pending', () => {
    expect(shouldPromoteNestedWheelToGesture({
      ...promoting,
      nestedWheelPending: false,
    })).toBe(false)
  })

  it('does not promote a programmatic scrollTop drop', () => {
    expect(shouldPromoteNestedWheelToGesture({
      ...promoting,
      programmatic: true,
    })).toBe(false)
  })
})
