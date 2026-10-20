import { describe, expect, it } from 'vitest'
import {
  computeWindowedIds,
  DEFAULT_ITEM_HEIGHT,
  DEFAULT_OVERSCAN_PX,
  estimateItemsHeight,
  extraNonWindowedChildrenHeight,
  resolveFollowWindowScrollTop,
  shouldAdvanceFollowChaseBaseline,
  shouldChaseFollowBottomOnContentGrowth,
  shouldChaseFollowBottomOnResize,
  shouldChaseFollowBottom,
  shouldChaseFollowBottomOnSizeChange,
  shouldTrustFollowBottomContentMeasurements,
  shouldExitFollowBottom,
  shouldInvalidateItemHeightsOnWidthChange,
  shouldSettleScrollToEnd,
} from '@/components/shadcn/ui/message-scroller/compute-windowed-ids'

/**
 * Regression for the at-rest follow-bottom 2-cycle:
 * chase scrollToEnd writes live maxScrollTop, computeWindowedIds walks stale
 * short itemHeights, the window collapses to the tail, placeholders shrink
 * scrollHeight, the browser clamps scrollTop, the window expands, remounts
 * grow scrollHeight, content ResizeObserver chases again.
 *
 * Production guards (cached-end follow window, chase whenever the viewport
 * is off the live edge) must converge without streaming, without wiping
 * heights, and without widening the pane after ignition. Chase does not
 * wait for the height cache to match the DOM. A width change does not
 * clear the height map. The mounted window stays on the cached tail.
 *
 * Send while stuck to the bottom is scrollToEnd, not align-start: see
 * shouldAnchorOnContentChange in compute-windowed-ids.test.ts.
 */

const SCROLL_EPSILON = 0.5
const SCROLL_EDGE_THRESHOLD = 8

type ResizeSource = 'content' | 'viewport'
type ChasePolicy = 'all-content' | 'content-growth' | 'content-size' | 'viewport-only'
type FollowWindow = 'live' | 'cached-end'

interface SimulatorOptions {
  applyGuardsFromFrame?: number
  chasePolicy?: ChasePolicy
  extraChildHeight?: number
  followWindow?: FollowWindow
  frames: number
  gap: number
  itemCount: number
  invalidateOnWidthChange?: boolean
  lateTrueHeight?: number
  lateTrueHeightFromFrame?: number
  oldHeight: number
  overscanPx: number
  placeholderRefreshFrame?: number
  reportPolicy: 'raceUnmount' | 'allMounted'
  roundReportedHeights?: boolean
  staleUnmountedHeight?: number
  trueHeight: number
  useMeasuredCount?: boolean
  viewportHeight: number
}

interface FrameOut {
  chase: boolean
  clamped: boolean
  distanceFromEnd: number
  exitFollowIfScrolledUp: boolean
  Hdom: number
  heightMapSize: number
  mountedKey: string
  mountedSize: number
  scrollTop: number
  settle: boolean
  source: ResizeSource
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String(index))
}

function windowKey(mounted: ReadonlySet<string>): string {
  return [...mounted].join(',')
}

function measuredItemCount(itemIds: readonly string[], heights: ReadonlyMap<string, number>): number {
  let count = 0
  for (const id of itemIds) {
    if (heights.has(id))
      count += 1
  }
  return count
}

function reportedHeight(height: number, roundReportedHeights: boolean): number {
  return roundReportedHeights ? Math.round(height) : height
}

function applyFixedGuards(): Pick<SimulatorOptions, 'chasePolicy' | 'followWindow'> {
  return {
    chasePolicy: 'content-size',
    followWindow: 'cached-end',
  }
}

function windowScrollTopFor({
  followWindow,
  estimatedHeight,
  scrollTop,
  viewportHeight,
}: {
  followWindow: FollowWindow
  estimatedHeight: number
  scrollTop: number
  viewportHeight: number
}): number {
  if (followWindow === 'cached-end') {
    return resolveFollowWindowScrollTop({
      estimatedHeight,
      viewportHeight,
    })
  }
  return scrollTop
}

function chaseFollowFrame({
  policy,
  source,
  grew,
  trusted,
  offEnd,
}: {
  policy: ChasePolicy
  source: ResizeSource
  grew: boolean
  trusted: boolean
  offEnd: boolean
}): boolean {
  if (policy === 'content-size')
    return shouldChaseFollowBottom({ offEnd })
  const allowChase = source === 'viewport'
    || policy === 'all-content'
    || (policy === 'content-growth' && grew && trusted)
  return allowChase && offEnd
}

function simulateFollowBottomWidthChange({
  applyGuardsFromFrame,
  chasePolicy = 'all-content',
  extraChildHeight = 0,
  followWindow = 'live',
  frames,
  gap,
  itemCount,
  invalidateOnWidthChange = false,
  lateTrueHeight,
  lateTrueHeightFromFrame,
  oldHeight,
  overscanPx,
  placeholderRefreshFrame,
  reportPolicy,
  roundReportedHeights = false,
  staleUnmountedHeight,
  trueHeight,
  useMeasuredCount = true,
  viewportHeight,
}: SimulatorOptions) {
  const itemIds = ids(itemCount)
  const heights = new Map(itemIds.map((id) => [id, oldHeight]))
  const estimated = () => estimateItemsHeight({
    gap,
    heights,
    itemIds,
  })

  let policy = chasePolicy
  let liveFollowWindow = followWindow
  let scrollTop = Math.max(0, estimated() - viewportHeight)
  let mounted = computeWindowedIds({
    gap,
    heights,
    itemIds,
    overscanPx,
    scrollTop: windowScrollTopFor({
      estimatedHeight: estimated(),
      followWindow: liveFollowWindow,
      scrollTop,
      viewportHeight,
    }),
    viewportHeight,
  })
  let liveTrueHeight = trueHeight
  let shouldClearHeightsOnWidth = invalidateOnWidthChange
  let previousScrollHeight = 0

  const framesOut: FrameOut[] = []

  for (let frame = 0; frame < frames; frame += 1) {
    if (applyGuardsFromFrame !== undefined && frame === applyGuardsFromFrame) {
      const fixed = applyFixedGuards()
      policy = fixed.chasePolicy ?? policy
      liveFollowWindow = fixed.followWindow ?? liveFollowWindow
    }

    if (
      lateTrueHeight !== undefined
      && lateTrueHeightFromFrame !== undefined
      && frame === lateTrueHeightFromFrame
    ) {
      liveTrueHeight = lateTrueHeight
      for (const id of mounted)
        heights.set(id, reportedHeight(liveTrueHeight, roundReportedHeights))
    }

    if (
      shouldClearHeightsOnWidth
      && shouldInvalidateItemHeightsOnWidthChange({
        clientHeight: viewportHeight,
        clientWidth: 480,
        lastClientWidth: 800,
      })
    ) {
      heights.clear()
      shouldClearHeightsOnWidth = false
    }

    const windowItemIdSet = new Set(itemIds)
    const children: Array<{ height: number, messageId?: string }> = []
    let Hdom = 0
    const placeholdersStale = staleUnmountedHeight !== undefined
      && (placeholderRefreshFrame === undefined || frame < placeholderRefreshFrame)
    for (let index = 0; index < itemCount; index += 1) {
      const id = itemIds[index]
      if (!id)
        continue
      const cachedUnmounted = heights.get(id) ?? DEFAULT_ITEM_HEIGHT
      const unmountedHeight = placeholdersStale
        ? staleUnmountedHeight
        : cachedUnmounted
      const height = mounted.has(id) ? liveTrueHeight : unmountedHeight
      children.push({ height, messageId: id })
      Hdom += height
      if (index < itemCount - 1)
        Hdom += gap
    }
    if (extraChildHeight > 0)
      children.push({ height: extraChildHeight })
    const extraChildrenHeight = extraNonWindowedChildrenHeight({
      children,
      gap,
      windowItemIds: windowItemIdSet,
    })
    Hdom += extraChildrenHeight

    const maxScrollTop = Math.max(0, Hdom - viewportHeight)
    const beforeClamp = scrollTop
    if (scrollTop > maxScrollTop)
      scrollTop = maxScrollTop
    const clamped = scrollTop !== beforeClamp
    const source: ResizeSource = frame === 0 ? 'viewport' : 'content'
    const grew = shouldChaseFollowBottomOnContentGrowth({
      previousScrollHeight,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: Hdom,
    })
    const trusted = shouldTrustFollowBottomContentMeasurements({
      estimatedHeight: estimated(),
      extraChildrenHeight,
      measuredCount: useMeasuredCount ? measuredItemCount(itemIds, heights) : 0,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: Hdom,
    })
    const offEnd = shouldChaseFollowBottomOnResize({
      clientHeight: viewportHeight,
      maxScrollTop,
      scrollEpsilon: SCROLL_EPSILON,
      scrollTop,
    })
    const chase = chaseFollowFrame({
      grew,
      offEnd,
      policy,
      source,
      trusted,
    })
    const settle = shouldSettleScrollToEnd({
      hasStreamingTurn: false,
      maxScrollTop,
      mode: 'following-bottom',
      nextMode: 'following-bottom',
      scrollEpsilon: SCROLL_EPSILON,
      scrollTop,
      spacerHeight: 0,
    })
    const distanceFromEnd = maxScrollTop - scrollTop
    const exitFollowIfScrolledUp = shouldExitFollowBottom({
      autoscrolling: false,
      distanceFromEnd,
      scrolledUp: clamped,
      threshold: SCROLL_EDGE_THRESHOLD,
    })

    previousScrollHeight = Hdom
    if (chase)
      scrollTop = maxScrollTop

    const nextMounted = computeWindowedIds({
      gap,
      heights,
      itemIds,
      overscanPx,
      scrollTop: windowScrollTopFor({
        estimatedHeight: estimated(),
        followWindow: liveFollowWindow,
        scrollTop,
        viewportHeight,
      }),
      viewportHeight,
    })

    if (reportPolicy === 'allMounted') {
      for (const id of nextMounted)
        heights.set(id, reportedHeight(liveTrueHeight, roundReportedHeights))
    }
    else {
      for (const id of nextMounted) {
        if (mounted.has(id))
          heights.set(id, reportedHeight(liveTrueHeight, roundReportedHeights))
      }
    }

    framesOut.push({
      chase,
      clamped,
      distanceFromEnd,
      exitFollowIfScrolledUp,
      Hdom,
      heightMapSize: heights.size,
      mountedKey: windowKey(nextMounted),
      mountedSize: nextMounted.size,
      scrollTop,
      settle,
      source,
    })
    mounted = nextMounted
  }

  return framesOut
}

function simulatePinnedContentHeightChanges({
  extraChildHeight = 0,
  gap = 0,
  heightsSequence,
  viewportHeight,
}: {
  extraChildHeight?: number
  gap?: number
  heightsSequence: readonly number[]
  viewportHeight: number
}) {
  const firstHeight = heightsSequence[0]
  if (firstHeight === undefined)
    return []

  const extraChildrenHeight = extraNonWindowedChildrenHeight({
    children: extraChildHeight > 0
      ? [{ height: firstHeight, messageId: '0' }, { height: extraChildHeight }]
      : [{ height: firstHeight, messageId: '0' }],
    gap,
    windowItemIds: new Set(['0']),
  })
  const observed = (itemHeight: number) => itemHeight + extraChildrenHeight

  let scrollTop = Math.max(0, observed(firstHeight) - viewportHeight)
  const framesOut: Array<{
    chase: boolean
    distanceFromEnd: number
    Hdom: number
    scrollTop: number
  }> = []

  for (let index = 1; index < heightsSequence.length; index += 1) {
    const itemHeight = heightsSequence[index]
    if (itemHeight === undefined)
      continue
    const Hdom = observed(itemHeight)
    const maxScrollTop = Math.max(0, Hdom - viewportHeight)
    const offEnd = shouldChaseFollowBottomOnResize({
      clientHeight: viewportHeight,
      maxScrollTop,
      scrollEpsilon: SCROLL_EPSILON,
      scrollTop,
    })
    const chase = shouldChaseFollowBottom({ offEnd })
    if (chase)
      scrollTop = maxScrollTop
    else if (scrollTop > maxScrollTop)
      scrollTop = maxScrollTop
    framesOut.push({
      chase,
      distanceFromEnd: maxScrollTop - scrollTop,
      Hdom,
      scrollTop,
    })
  }

  return framesOut
}

function isTwoCycle(
  framesOut: Array<{ Hdom: number, mountedKey: string, scrollTop: number }>,
): boolean {
  if (framesOut.length < 4)
    return false
  const a = framesOut[framesOut.length - 2]
  const b = framesOut[framesOut.length - 1]
  const c = framesOut[framesOut.length - 4]
  const d = framesOut[framesOut.length - 3]
  if (!a || !b || !c || !d)
    return false
  return (
    a.mountedKey === c.mountedKey
    && b.mountedKey === d.mountedKey
    && a.mountedKey !== b.mountedKey
    && a.Hdom === c.Hdom
    && b.Hdom === d.Hdom
    && a.scrollTop === c.scrollTop
    && b.scrollTop === d.scrollTop
  )
}

function expectConverged(framesOut: FrameOut[]) {
  expect(isTwoCycle(framesOut)).toBe(false)
  const last = framesOut.at(-1)
  const prev = framesOut.at(-2)
  expect(last?.mountedKey).toBe(prev?.mountedKey)
  expect(last?.Hdom).toBe(prev?.Hdom)
  expect(last?.scrollTop).toBe(prev?.scrollTop)
  expect(last?.chase).toBe(false)
  expect(last?.exitFollowIfScrolledUp).toBe(false)
}

const scenario20 = {
  gap: 24,
  itemCount: 20,
  oldHeight: 80,
  overscanPx: DEFAULT_OVERSCAN_PX,
  trueHeight: 180,
  viewportHeight: 400,
} as const

const scenario40 = {
  gap: 24,
  itemCount: 40,
  oldHeight: 160,
  overscanPx: DEFAULT_OVERSCAN_PX,
  trueHeight: 320,
  viewportHeight: 600,
} as const

describe('stale-height follow-bottom resize loop', () => {
  it('uses the production overscan of 800px for both scenarios', () => {
    expect(DEFAULT_OVERSCAN_PX).toBe(800)
    expect(scenario20.overscanPx).toBe(800)
    expect(scenario40.overscanPx).toBe(800)
  })

  describe('pre-fix model (documents the bug mechanism)', () => {
    it('oscillates when newly windowed ids unmount before reportItemHeight', () => {
      const framesOut = simulateFollowBottomWidthChange({
        frames: 8,
        reportPolicy: 'raceUnmount',
        ...scenario20,
      })

      expect(isTwoCycle(framesOut)).toBe(true)

      const collapsed = framesOut.filter((frame) => frame.mountedSize === 1)
      const expanded = framesOut.filter((frame) => frame.mountedSize === 11)
      expect(collapsed.length).toBeGreaterThanOrEqual(2)
      expect(expanded.length).toBeGreaterThanOrEqual(2)

      expect(collapsed[0]).toMatchObject({
        Hdom: 3256,
        chase: true,
        settle: false,
        mountedKey: '19',
        scrollTop: 2856,
        source: 'viewport',
      })
      expect(expanded[0]).toMatchObject({
        Hdom: 2156,
        chase: false,
        clamped: true,
        mountedKey: '9,10,11,12,13,14,15,16,17,18,19',
        scrollTop: 1756,
        source: 'content',
      })

      expect(collapsed[0]?.exitFollowIfScrolledUp).toBe(false)
      expect(expanded[0]?.exitFollowIfScrolledUp).toBe(false)
      expect(expanded[0]?.distanceFromEnd).toBe(0)
    })
  })

  describe('fixed guards (cached-end window plus off-end chase)', () => {
    it('converges for 20 items at rest after narrowing', () => {
      const framesOut = simulateFollowBottomWidthChange({
        frames: 8,
        reportPolicy: 'raceUnmount',
        ...applyFixedGuards(),
        ...scenario20,
      })

      expectConverged(framesOut)
      expect(framesOut[0]?.source).toBe('viewport')
      expect(framesOut[0]?.chase).toBe(true)
      expect(framesOut.slice(1).every((frame) => frame.source === 'content')).toBe(true)
      expect(framesOut.every((frame) => frame.heightMapSize === scenario20.itemCount)).toBe(true)
      expect(framesOut.at(-1)).toMatchObject({
        distanceFromEnd: 0,
        mountedKey: '14,15,16,17,18,19',
        settle: true,
      })
      expect(framesOut.at(-1)?.mountedKey).not.toBe('19')
    })

    it('converges for 40 items at rest after narrowing', () => {
      const framesOut = simulateFollowBottomWidthChange({
        frames: 10,
        reportPolicy: 'raceUnmount',
        ...applyFixedGuards(),
        ...scenario40,
      })

      expectConverged(framesOut)
      expect(framesOut[0]?.chase).toBe(true)
      expect(framesOut.at(-1)?.distanceFromEnd).toBe(0)
      expect(framesOut.every((frame) => frame.heightMapSize === scenario40.itemCount)).toBe(true)
      expect(framesOut.at(-1)?.mountedKey).not.toBe('39')
      expect(framesOut.at(-1)?.mountedKey?.endsWith('39')).toBe(true)
    })

    it('converges when every mounted id can report its new height', () => {
      const framesOut = simulateFollowBottomWidthChange({
        frames: 8,
        reportPolicy: 'allMounted',
        ...applyFixedGuards(),
        ...scenario40,
      })

      expect(isTwoCycle(framesOut)).toBe(false)
      const last = framesOut.at(-1)
      const prev = framesOut.at(-2)
      expect(last?.mountedKey).toBe(prev?.mountedKey)
      expect(last?.Hdom).toBe(prev?.Hdom)
      expect(last?.scrollTop).toBe(prev?.scrollTop)
      expect(last?.chase).toBe(false)
      expect(last?.exitFollowIfScrolledUp).toBe(false)
    })

    it('stops an already ignited loop at the same narrow width', () => {
      const framesOut = simulateFollowBottomWidthChange({
        applyGuardsFromFrame: 8,
        frames: 16,
        reportPolicy: 'raceUnmount',
        ...scenario20,
      })

      const ignited = framesOut.slice(0, 8)
      expect(isTwoCycle(ignited)).toBe(true)

      const afterFix = framesOut.slice(8)
      expectConverged(afterFix)
      expect(afterFix.every((frame) => frame.source === 'content')).toBe(true)
    })

    it('does not clear heights after a width change that occurred while the viewport had no height', () => {
      const heights = new Map(ids(scenario20.itemCount).map((id) => [id, scenario20.oldHeight]))
      expect(shouldInvalidateItemHeightsOnWidthChange({
        clientHeight: 0,
        clientWidth: 480,
        lastClientWidth: 800,
      })).toBe(false)
      expect(heights.size).toBe(scenario20.itemCount)

      expect(shouldInvalidateItemHeightsOnWidthChange({
        clientHeight: scenario20.viewportHeight,
        clientWidth: 480,
        lastClientWidth: 800,
      })).toBe(false)
      expect(heights.size).toBe(scenario20.itemCount)

      const framesOut = simulateFollowBottomWidthChange({
        frames: 8,
        reportPolicy: 'raceUnmount',
        ...applyFixedGuards(),
        ...scenario20,
      })
      expectConverged(framesOut)
      expect(framesOut.at(-1)?.distanceFromEnd).toBe(0)
      expect(framesOut.every((frame) => frame.heightMapSize === scenario20.itemCount)).toBe(true)
      expect(framesOut.at(-1)?.mountedKey).toBe('14,15,16,17,18,19')
    })

    it('chases content growth while pinned and lands at the new bottom', () => {
      const framesOut = simulatePinnedContentHeightChanges({
        heightsSequence: [1000, 1400],
        viewportHeight: 400,
      })

      expect(framesOut).toEqual([{
        chase: true,
        distanceFromEnd: 0,
        Hdom: 1400,
        scrollTop: 1000,
      }])
    })

    it('chases a trusted shrink onto the new follow end', () => {
      const previousScrollHeight = 1400
      const scrollHeight = 1000
      const viewportHeight = 400
      const scrollTop = 1000
      const maxScrollTop = Math.max(0, scrollHeight - viewportHeight)
      const sizeChanged = shouldChaseFollowBottomOnSizeChange({
        previousScrollHeight,
        scrollEpsilon: SCROLL_EPSILON,
        scrollHeight,
      })
      const trust = shouldTrustFollowBottomContentMeasurements({
        estimatedHeight: scrollHeight,
        scrollEpsilon: SCROLL_EPSILON,
        scrollHeight,
      })
      const offEnd = shouldChaseFollowBottomOnResize({
        clientHeight: viewportHeight,
        maxScrollTop,
        scrollEpsilon: SCROLL_EPSILON,
        scrollTop,
      })
      const chase = offEnd && sizeChanged && trust
      expect(sizeChanged).toBe(true)
      expect(trust).toBe(true)
      expect(chase).toBe(true)
      expect(maxScrollTop).toBe(600)
    })

    it('chases an untrusted shrink when the reader is off the live edge', () => {
      const previousScrollHeight = 1400
      const scrollHeight = 1000
      const viewportHeight = 400
      const scrollTop = 1000
      const maxScrollTop = Math.max(0, scrollHeight - viewportHeight)
      const trust = shouldTrustFollowBottomContentMeasurements({
        estimatedHeight: previousScrollHeight,
        scrollEpsilon: SCROLL_EPSILON,
        scrollHeight,
      })
      const offEnd = shouldChaseFollowBottomOnResize({
        clientHeight: viewportHeight,
        maxScrollTop,
        scrollEpsilon: SCROLL_EPSILON,
        scrollTop,
      })
      expect(trust).toBe(false)
      expect(offEnd).toBe(true)
      expect(shouldChaseFollowBottom({ offEnd })).toBe(true)
      expect(maxScrollTop).toBe(600)
    })

    it('does not re-ignite after a narrowing drag plus late content growth', () => {
      const framesOut = simulateFollowBottomWidthChange({
        frames: 16,
        lateTrueHeight: 280,
        lateTrueHeightFromFrame: 8,
        reportPolicy: 'raceUnmount',
        ...applyFixedGuards(),
        ...scenario20,
      })

      expect(isTwoCycle(framesOut)).toBe(false)
      const lateGrowth = framesOut[8]
      expect(lateGrowth?.source).toBe('content')
      expect(lateGrowth?.chase).toBe(true)
      expectConverged(framesOut)
      expect(framesOut.at(-1)?.distanceFromEnd).toBe(0)
    })

    it('does not ignite a 2-cycle when a non-windowed question card is present', () => {
      const extraChildHeight = 120
      const framesOut = simulateFollowBottomWidthChange({
        extraChildHeight,
        frames: 8,
        reportPolicy: 'raceUnmount',
        ...applyFixedGuards(),
        ...scenario20,
      })

      expect(isTwoCycle(framesOut)).toBe(false)
      expectConverged(framesOut)
      expect(framesOut.every((frame) => frame.heightMapSize === scenario20.itemCount)).toBe(true)
      expect(framesOut.at(-1)?.mountedKey).toBe('14,15,16,17,18,19')
    })

    it('chases pinned growth with a non-windowed question card counted in trust', () => {
      const extraChildHeight = 120
      const gap = 24
      const extraChildrenHeight = extraChildHeight + gap
      const framesOut = simulatePinnedContentHeightChanges({
        extraChildHeight,
        gap,
        heightsSequence: [1000, 1400],
        viewportHeight: 400,
      })

      expect(framesOut).toEqual([{
        chase: true,
        distanceFromEnd: 0,
        Hdom: 1400 + extraChildrenHeight,
        scrollTop: 1000 + extraChildrenHeight,
      }])

      const withoutExtraInTrust = simulatePinnedContentHeightChanges({
        extraChildHeight,
        gap,
        heightsSequence: [1000, 1400],
        viewportHeight: 400,
      })
      expect(withoutExtraInTrust).toEqual([{
        chase: true,
        distanceFromEnd: 0,
        Hdom: 1400 + extraChildrenHeight,
        scrollTop: 1000 + extraChildrenHeight,
      }])
    })

    it('does not re-ignite after narrowing plus late growth with a question card present', () => {
      const framesOut = simulateFollowBottomWidthChange({
        extraChildHeight: 120,
        frames: 16,
        lateTrueHeight: 280,
        lateTrueHeightFromFrame: 8,
        reportPolicy: 'raceUnmount',
        ...applyFixedGuards(),
        ...scenario20,
      })

      expect(isTwoCycle(framesOut)).toBe(false)
      const lateGrowth = framesOut[8]
      expect(lateGrowth?.source).toBe('content')
      expect(lateGrowth?.chase).toBe(true)
      expect(isTwoCycle(framesOut.slice(8))).toBe(false)
    })
  })

  describe('rounding drift and post-drag placeholder identity', () => {
    function simulateRoundedHeightGrowth({
      growth,
      itemCount,
      trueHeight,
      useMeasuredCount,
      viewportHeight,
    }: {
      growth: number
      itemCount: number
      trueHeight: number
      useMeasuredCount: boolean
      viewportHeight: number
    }) {
      const itemIds = ids(itemCount)
      const heights = new Map(itemIds.map((id) => [id, Math.round(trueHeight)]))
      const estimatedHeight = estimateItemsHeight({
        gap: 0,
        heights,
        itemIds,
      })
      const Hdom = trueHeight * itemCount
      const previousScrollHeight = Hdom - growth
      const maxScrollTop = Math.max(0, Hdom - viewportHeight)
      let scrollTop = Math.max(0, previousScrollHeight - viewportHeight)
      const trusted = shouldTrustFollowBottomContentMeasurements({
        estimatedHeight,
        measuredCount: useMeasuredCount ? measuredItemCount(itemIds, heights) : 0,
        scrollEpsilon: SCROLL_EPSILON,
        scrollHeight: Hdom,
      })
      const offEnd = shouldChaseFollowBottomOnResize({
        clientHeight: viewportHeight,
        maxScrollTop,
        scrollEpsilon: SCROLL_EPSILON,
        scrollTop,
      })
      const chase = shouldChaseFollowBottom({ offEnd })
      if (chase)
        scrollTop = maxScrollTop
      return {
        chase,
        distanceFromEnd: maxScrollTop - scrollTop,
        estimatedHeight,
        Hdom,
        trusted,
      }
    }

    it('rounding drift chases even when the height cache is a few pixels short', () => {
      const result = simulateRoundedHeightGrowth({
        growth: 10,
        itemCount: 10,
        trueHeight: 332.4,
        useMeasuredCount: false,
        viewportHeight: 800,
      })

      expect(result.Hdom - result.estimatedHeight).toBeCloseTo(4)
      expect(result.trusted).toBe(false)
      expect(result.chase).toBe(true)
      expect(result.distanceFromEnd).toBe(0)
    })

    it('post-fix rounding drift still converges to the live edge', () => {
      const result = simulateRoundedHeightGrowth({
        growth: 10,
        itemCount: 10,
        trueHeight: 332.4,
        useMeasuredCount: true,
        viewportHeight: 800,
      })

      expect(result.trusted).toBe(true)
      expect(result.chase).toBe(true)
      expect(result.distanceFromEnd).toBe(0)
    })

    it('post-drag stale placeholders still chase to the live edge', () => {
      const stalled = simulateFollowBottomWidthChange({
        frames: 16,
        lateTrueHeight: 280,
        lateTrueHeightFromFrame: 8,
        reportPolicy: 'raceUnmount',
        staleUnmountedHeight: scenario20.oldHeight,
        ...applyFixedGuards(),
        ...scenario20,
      })
      expect(stalled[8]?.source).toBe('content')
      expect(stalled[8]?.chase).toBe(true)
      expect(stalled.at(-1)?.distanceFromEnd).toBe(0)
      expect(isTwoCycle(stalled)).toBe(false)

      const recovered = simulateFollowBottomWidthChange({
        frames: 16,
        lateTrueHeight: 280,
        lateTrueHeightFromFrame: 8,
        placeholderRefreshFrame: 1,
        reportPolicy: 'raceUnmount',
        staleUnmountedHeight: scenario20.oldHeight,
        ...applyFixedGuards(),
        ...scenario20,
      })
      expect(recovered[0]?.source).toBe('viewport')
      expect(recovered[8]?.source).toBe('content')
      expect(recovered[8]?.chase).toBe(true)
      expectConverged(recovered)
      expect(recovered.at(-1)?.distanceFromEnd).toBe(0)
    })

    it('scaled tolerance still rejects the stale-height pump', () => {
      const measuredCount = 11
      const perItemMismatch = 100
      const estimatedHeight = measuredCount * DEFAULT_ITEM_HEIGHT
      expect(shouldTrustFollowBottomContentMeasurements({
        estimatedHeight,
        measuredCount,
        scrollEpsilon: SCROLL_EPSILON,
        scrollHeight: estimatedHeight + perItemMismatch * measuredCount,
      })).toBe(false)

      const framesOut = simulateFollowBottomWidthChange({
        chasePolicy: 'content-growth',
        frames: 8,
        invalidateOnWidthChange: false,
        reportPolicy: 'raceUnmount',
        useMeasuredCount: true,
        ...scenario20,
      })
      expect(framesOut.at(-1)).toMatchObject({
        distanceFromEnd: 1000,
        settle: false,
      })
    })
  })
})

describe('follow-bottom chase recheck after stale row heights', () => {
  type BaselinePolicy = 'always' | 'trust-or-chased'

  function evaluateFollowChaseSim({
    baselinePolicy,
    estimatedHeight,
    extraChildrenHeight = 0,
    lastScrollHeight,
    measuredCount,
    observedHeight,
    scrollTop,
    source,
    viewportHeight,
  }: {
    baselinePolicy: BaselinePolicy
    estimatedHeight: number
    extraChildrenHeight?: number
    lastScrollHeight: number
    measuredCount: number
    observedHeight: number
    scrollTop: number
    source: ResizeSource
    viewportHeight: number
  }) {
    const grew = source === 'content' && shouldChaseFollowBottomOnContentGrowth({
      previousScrollHeight: lastScrollHeight,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: observedHeight,
    })
    const trust = shouldTrustFollowBottomContentMeasurements({
      estimatedHeight,
      extraChildrenHeight,
      measuredCount,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: observedHeight,
    })
    const maxScrollTop = Math.max(0, observedHeight - viewportHeight)
    let nextScrollTop = scrollTop > maxScrollTop ? maxScrollTop : scrollTop
    const offEnd = shouldChaseFollowBottomOnResize({
      clientHeight: viewportHeight,
      maxScrollTop,
      scrollEpsilon: SCROLL_EPSILON,
      scrollTop: nextScrollTop,
    })
    const chased = shouldChaseFollowBottom({ offEnd })
    if (chased)
      nextScrollTop = maxScrollTop
    const advance = baselinePolicy === 'always'
      || source === 'viewport'
      || shouldAdvanceFollowChaseBaseline({ chased, trust })
    return {
      chased,
      distanceFromEnd: maxScrollTop - nextScrollTop,
      grew,
      lastScrollHeight: advance ? observedHeight : lastScrollHeight,
      offEnd,
      scrollTop: nextScrollTop,
      trust,
    }
  }

  const strandedFollow = {
    measuredCount: 1,
    staleHeight: 3618,
    liveHeight: 7834,
    viewportHeight: 800,
  } as const

  it('pre-fix trust gate strands after a growth frame', () => {
    const { liveHeight, measuredCount, staleHeight, viewportHeight } = strandedFollow
    const scrollTop = staleHeight - viewportHeight
    const maxScrollTop = liveHeight - viewportHeight
    const trust = shouldTrustFollowBottomContentMeasurements({
      estimatedHeight: staleHeight,
      measuredCount,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: liveHeight,
    })
    const offEnd = shouldChaseFollowBottomOnResize({
      clientHeight: viewportHeight,
      maxScrollTop,
      scrollEpsilon: SCROLL_EPSILON,
      scrollTop,
    })
    const sizeChanged = shouldChaseFollowBottomOnSizeChange({
      previousScrollHeight: staleHeight,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: liveHeight,
    })
    const chased = offEnd && sizeChanged && trust
    expect(trust).toBe(false)
    expect(offEnd).toBe(true)
    expect(chased).toBe(false)
    expect(maxScrollTop - scrollTop).toBeGreaterThan(0)

    const caughtUp = shouldTrustFollowBottomContentMeasurements({
      estimatedHeight: liveHeight,
      measuredCount,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: liveHeight,
    })
    const stillOff = shouldChaseFollowBottomOnResize({
      clientHeight: viewportHeight,
      maxScrollTop,
      scrollEpsilon: SCROLL_EPSILON,
      scrollTop,
    })
    const grewAgain = shouldChaseFollowBottomOnContentGrowth({
      previousScrollHeight: liveHeight,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: liveHeight,
    })
    expect(caughtUp).toBe(true)
    expect(stillOff).toBe(true)
    expect(grewAgain).toBe(false)
    expect(stillOff && grewAgain && caughtUp).toBe(false)
  })

  it('chases untrusted message growth on the same frame', () => {
    const { liveHeight, measuredCount, staleHeight, viewportHeight } = strandedFollow
    const chased = evaluateFollowChaseSim({
      baselinePolicy: 'trust-or-chased',
      estimatedHeight: staleHeight,
      lastScrollHeight: staleHeight,
      measuredCount,
      observedHeight: liveHeight,
      scrollTop: staleHeight - viewportHeight,
      source: 'content',
      viewportHeight,
    })
    expect(chased).toMatchObject({
      chased: true,
      distanceFromEnd: 0,
      grew: true,
      trust: false,
    })
  })

  it('stays put once the chase has landed on the live edge', () => {
    const { liveHeight, measuredCount, staleHeight, viewportHeight } = strandedFollow
    const first = evaluateFollowChaseSim({
      baselinePolicy: 'trust-or-chased',
      estimatedHeight: staleHeight,
      lastScrollHeight: staleHeight,
      measuredCount,
      observedHeight: liveHeight,
      scrollTop: staleHeight - viewportHeight,
      source: 'content',
      viewportHeight,
    })

    const next = evaluateFollowChaseSim({
      baselinePolicy: 'trust-or-chased',
      estimatedHeight: staleHeight,
      lastScrollHeight: first.lastScrollHeight,
      measuredCount,
      observedHeight: liveHeight,
      scrollTop: first.scrollTop,
      source: 'content',
      viewportHeight,
    })
    expect(next.trust).toBe(false)
    expect(next.offEnd).toBe(false)
    expect(next.chased).toBe(false)
    expect(next.distanceFromEnd).toBe(0)
  })

  it('converges from row reports when the content resize never fires', () => {
    const { liveHeight, measuredCount, staleHeight, viewportHeight } = strandedFollow
    const scrollTop = staleHeight - viewportHeight
    const maxScrollTop = liveHeight - viewportHeight
    expect(maxScrollTop - scrollTop).toBeGreaterThan(0)

    const recheck = evaluateFollowChaseSim({
      baselinePolicy: 'trust-or-chased',
      estimatedHeight: liveHeight,
      lastScrollHeight: staleHeight,
      measuredCount,
      observedHeight: liveHeight,
      scrollTop,
      source: 'content',
      viewportHeight,
    })
    expect(recheck).toMatchObject({
      chased: true,
      distanceFromEnd: 0,
      grew: true,
      trust: true,
    })
  })

  it('chases a stale height mismatch instead of leaving the reader short', () => {
    const measuredCount = 11
    const perItemMismatch = 100
    const estimatedHeight = measuredCount * DEFAULT_ITEM_HEIGHT
    const observedHeight = estimatedHeight + perItemMismatch * measuredCount
    const viewportHeight = scenario20.viewportHeight
    const chased = evaluateFollowChaseSim({
      baselinePolicy: 'trust-or-chased',
      estimatedHeight,
      lastScrollHeight: estimatedHeight,
      measuredCount,
      observedHeight,
      scrollTop: Math.max(0, estimatedHeight - viewportHeight),
      source: 'content',
      viewportHeight,
    })
    expect(chased).toMatchObject({
      chased: true,
      distanceFromEnd: 0,
      grew: true,
      trust: false,
    })
  })
})

describe('follow window offset while stuck to the bottom', () => {
  it('keeps the tail when live scrollTop is past the cache, with or without pinned ids', () => {
    const itemIds = ids(6)
    const heights = new Map(itemIds.map((id) => [id, 100]))
    const estimatedHeight = estimateItemsHeight({
      gap: 0,
      heights,
      itemIds,
    })
    const viewportHeight = 200
    const liveScrollTop = 2000
    const followOffset = resolveFollowWindowScrollTop({
      estimatedHeight,
      viewportHeight,
    })
    const collapsed = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 0,
      pinnedIds: ['5'],
      scrollTop: liveScrollTop,
      viewportHeight,
    })
    const followed = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 0,
      pinnedIds: ['5'],
      scrollTop: followOffset,
      viewportHeight,
    })
    const followedWithoutPin = computeWindowedIds({
      gap: 0,
      heights,
      itemIds,
      overscanPx: 0,
      scrollTop: followOffset,
      viewportHeight,
    })

    expect(followOffset).toBe(400)
    expect([...collapsed]).toEqual(['5'])
    expect([...followed]).toEqual(['3', '4', '5'])
    expect([...followedWithoutPin]).toEqual(['3', '4', '5'])
  })

  it('keeps each new trailing row on the cached end, not a pinned-only set', () => {
    const viewportHeight = 200
    let itemIds = ids(4)
    const heights = new Map(itemIds.map((id) => [id, 100]))

    const mountAtCache = (idsNow: readonly string[]) => {
      const estimatedHeight = estimateItemsHeight({
        gap: 0,
        heights,
        itemIds: idsNow,
      })
      const scrollTop = resolveFollowWindowScrollTop({
        estimatedHeight,
        viewportHeight,
      })
      return {
        estimatedHeight,
        mounted: [...computeWindowedIds({
          gap: 0,
          heights,
          itemIds: idsNow,
          overscanPx: 0,
          pinnedIds: idsNow.at(-1) ? [idsNow.at(-1)!] : [],
          scrollTop,
          viewportHeight,
        })],
        scrollTop,
      }
    }

    const before = mountAtCache(itemIds)
    expect(before.scrollTop).toBe(200)
    expect(before.mounted).toEqual(['1', '2', '3'])

    itemIds = [...itemIds, '4']
    heights.set('4', 100)
    const after = mountAtCache(itemIds)
    expect(after.scrollTop).toBe(resolveFollowWindowScrollTop({
      estimatedHeight: after.estimatedHeight,
      viewportHeight,
    }))
    expect(after.mounted).toEqual(['2', '3', '4'])
    expect(after.mounted).not.toEqual(['4'])
  })
})

describe('reading scrollTop after width-driven height deltas', () => {
  function readingScrollTopAfterHeightDeltas({
    deltas,
    itemOffsets,
    scrollEpsilon = SCROLL_EPSILON,
    scrollTop,
  }: {
    deltas: readonly number[]
    itemOffsets: readonly number[]
    scrollEpsilon?: number
    scrollTop: number
  }): number {
    // Pure sum of deltas for items whose offset is above the viewport.
    let next = scrollTop
    for (let index = 0; index < itemOffsets.length; index += 1) {
      const offset = itemOffsets[index]
      const delta = deltas[index]
      if (offset === undefined || delta === undefined)
        continue
      if (delta !== 0 && offset < scrollTop - scrollEpsilon)
        next += delta
    }
    return next
  }

  it('adds only the deltas of items whose offset is above scrollTop', () => {
    expect(readingScrollTopAfterHeightDeltas({
      deltas: [20, 30, 40, 50],
      itemOffsets: [0, 100, 250, 400],
      scrollTop: 250,
    })).toBe(300)
  })

  it('leaves scrollTop unchanged when every item is in or below the viewport', () => {
    expect(readingScrollTopAfterHeightDeltas({
      deltas: [80, 80],
      itemOffsets: [400, 520],
      scrollTop: 400,
    })).toBe(400)
  })
})
