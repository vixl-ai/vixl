import { describe, expect, it } from 'vitest'
import {
  computeWindowedIds,
  DEFAULT_ITEM_HEIGHT,
  DEFAULT_OVERSCAN_PX,
  estimateItemsHeight,
  extraNonWindowedChildrenHeight,
  shouldChaseFollowBottomOnContentGrowth,
  shouldChaseFollowBottomOnResize,
  shouldTrustFollowBottomContentMeasurements,
  shouldExitFollowBottom,
  shouldInvalidateItemHeightsOnWidthChange,
  shouldSampleClientWidthBaseline,
  shouldSettleScrollToEnd,
} from '@/components/shadcn/ui/message-scroller/compute-windowed-ids'

/**
 * Regression for the at-rest follow-bottom 2-cycle:
 * chase scrollToEnd writes live maxScrollTop, computeWindowedIds walks stale
 * short itemHeights, the window collapses to the tail, placeholders shrink
 * scrollHeight, the browser clamps scrollTop, the window expands, remounts
 * grow scrollHeight, content ResizeObserver chases again.
 *
 * Production guards (width invalidation plus measured growth-gated chase) must
 * converge without streaming and without widening the pane after ignition.
 * Growth-only chase never fires on shrink or clamp frames. Chase also requires
 * itemHeights to match the DOM, so stale-placeholder remount growth cannot
 * pump. Width invalidation still clears heights after a real width change.
 */

const SCROLL_EPSILON = 0.5
const SCROLL_EDGE_THRESHOLD = 8

type ResizeSource = 'content' | 'viewport'
type ChasePolicy = 'all-content' | 'content-growth' | 'viewport-only'

interface SimulatorOptions {
  applyGuardsFromFrame?: number
  chasePolicy?: ChasePolicy
  extraChildHeight?: number
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

function applyFixedGuards(): Pick<SimulatorOptions, 'chasePolicy' | 'invalidateOnWidthChange'> {
  return {
    chasePolicy: 'content-growth',
    invalidateOnWidthChange: true,
  }
}

function syncItemHeightsToViewportWidth({
  clientHeight,
  clientWidth,
  heights,
  lastClientWidth,
}: {
  clientHeight: number
  clientWidth: number
  heights: Map<string, number>
  lastClientWidth: number
}) {
  let nextLastClientWidth = lastClientWidth
  if (shouldInvalidateItemHeightsOnWidthChange({
    clientHeight,
    clientWidth,
    lastClientWidth,
  })) {
    heights.clear()
  }
  if (shouldSampleClientWidthBaseline({ clientHeight, clientWidth }))
    nextLastClientWidth = clientWidth
  return { lastClientWidth: nextLastClientWidth }
}

function simulateFollowBottomWidthChange({
  applyGuardsFromFrame,
  chasePolicy = 'all-content',
  extraChildHeight = 0,
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

  let scrollTop = Math.max(0, estimated() - viewportHeight)
  let mounted = computeWindowedIds({
    gap,
    heights,
    itemIds,
    overscanPx,
    scrollTop,
    viewportHeight,
  })
  let policy = chasePolicy
  let liveTrueHeight = trueHeight
  let shouldClearHeightsOnWidth = invalidateOnWidthChange
  let previousScrollHeight = 0

  const framesOut: FrameOut[] = []

  for (let frame = 0; frame < frames; frame += 1) {
    if (applyGuardsFromFrame !== undefined && frame === applyGuardsFromFrame) {
      policy = 'content-growth'
      heights.clear()
      shouldClearHeightsOnWidth = false
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
      const unmountedHeight = heights.get(id)
        ?? (placeholdersStale ? staleUnmountedHeight : DEFAULT_ITEM_HEIGHT)
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
    const allowChase = source === 'viewport'
      || policy === 'all-content'
      || (policy === 'content-growth' && grew && trusted)
    const chase = allowChase && shouldChaseFollowBottomOnResize({
      clientHeight: viewportHeight,
      maxScrollTop,
      scrollEpsilon: SCROLL_EPSILON,
      scrollTop,
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
      scrollTop,
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
  countExtraInTrust = true,
  extraChildHeight = 0,
  gap = 0,
  heightsSequence,
  viewportHeight,
}: {
  countExtraInTrust?: boolean
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
  let previousScrollHeight = observed(firstHeight)
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
    if (scrollTop > maxScrollTop)
      scrollTop = maxScrollTop
    const grew = shouldChaseFollowBottomOnContentGrowth({
      previousScrollHeight,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: Hdom,
    })
    const trusted = shouldTrustFollowBottomContentMeasurements({
      estimatedHeight: itemHeight,
      extraChildrenHeight: countExtraInTrust ? extraChildrenHeight : 0,
      scrollEpsilon: SCROLL_EPSILON,
      scrollHeight: Hdom,
    })
    const chase = grew && trusted && shouldChaseFollowBottomOnResize({
      clientHeight: viewportHeight,
      maxScrollTop,
      scrollEpsilon: SCROLL_EPSILON,
      scrollTop,
    })
    previousScrollHeight = Hdom
    if (chase)
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

  describe('fixed guards (width invalidation plus growth-gated chase)', () => {
    it('converges for 20 items at rest after narrowing', () => {
      const framesOut = simulateFollowBottomWidthChange({
        frames: 8,
        reportPolicy: 'raceUnmount',
        ...applyFixedGuards(),
        ...scenario20,
      })

      expectConverged(framesOut)
      expect(framesOut[0]?.source).toBe('viewport')
      expect(framesOut.slice(1).every((frame) => frame.source === 'content')).toBe(true)
      expect(framesOut.at(-1)).toMatchObject({
        Hdom: 3776,
        distanceFromEnd: 0,
        mountedKey: '14,15,16,17,18,19',
        scrollTop: 3376,
        settle: true,
      })

      const withoutInvalidation = simulateFollowBottomWidthChange({
        chasePolicy: 'content-growth',
        frames: 8,
        invalidateOnWidthChange: false,
        reportPolicy: 'raceUnmount',
        ...scenario20,
      })
      expect(isTwoCycle(withoutInvalidation)).toBe(false)
      expect(withoutInvalidation.at(-1)).toMatchObject({
        distanceFromEnd: 1000,
        mountedKey: '9,10,11,12,13,14,15,16,17,18',
        settle: false,
      })
    })

    it('converges for 40 items at rest after narrowing', () => {
      const framesOut = simulateFollowBottomWidthChange({
        frames: 10,
        reportPolicy: 'raceUnmount',
        ...applyFixedGuards(),
        ...scenario40,
      })

      expectConverged(framesOut)
      expect(framesOut.at(-1)).toMatchObject({
        Hdom: 8456,
        mountedKey: '33,34,35,36,37,38,39',
        scrollTop: 6896,
      })
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

    it('invalidates after a width change that occurred while the viewport had no height', () => {
      const heights = new Map(ids(scenario20.itemCount).map((id) => [id, scenario20.oldHeight]))
      let lastClientWidth = 800

      const hidden = syncItemHeightsToViewportWidth({
        clientHeight: 0,
        clientWidth: 480,
        heights,
        lastClientWidth,
      })
      lastClientWidth = hidden.lastClientWidth
      expect(lastClientWidth).toBe(800)
      expect(heights.size).toBe(scenario20.itemCount)

      const restored = syncItemHeightsToViewportWidth({
        clientHeight: scenario20.viewportHeight,
        clientWidth: 480,
        heights,
        lastClientWidth,
      })
      lastClientWidth = restored.lastClientWidth
      expect(lastClientWidth).toBe(480)
      expect(heights.size).toBe(0)

      const framesOut = simulateFollowBottomWidthChange({
        frames: 8,
        reportPolicy: 'raceUnmount',
        ...applyFixedGuards(),
        ...scenario20,
      })
      expectConverged(framesOut)
      expect(framesOut.at(-1)).toMatchObject({
        Hdom: 3776,
        distanceFromEnd: 0,
        mountedKey: '14,15,16,17,18,19',
        scrollTop: 3376,
        settle: true,
      })
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

    it('does not chase when content shrinks', () => {
      const framesOut = simulatePinnedContentHeightChanges({
        heightsSequence: [1400, 1000],
        viewportHeight: 400,
      })

      expect(framesOut).toEqual([{
        chase: false,
        distanceFromEnd: 0,
        Hdom: 1000,
        scrollTop: 600,
      }])
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
      expect(framesOut.at(-1)?.Hdom).toBe(3776 + extraChildHeight + scenario20.gap)
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
        countExtraInTrust: false,
        extraChildHeight,
        gap,
        heightsSequence: [1000, 1400],
        viewportHeight: 400,
      })
      expect(withoutExtraInTrust).toEqual([{
        chase: false,
        distanceFromEnd: 400,
        Hdom: 1400 + extraChildrenHeight,
        scrollTop: 600 + extraChildrenHeight,
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
      const grew = shouldChaseFollowBottomOnContentGrowth({
        previousScrollHeight,
        scrollEpsilon: SCROLL_EPSILON,
        scrollHeight: Hdom,
      })
      const trusted = shouldTrustFollowBottomContentMeasurements({
        estimatedHeight,
        measuredCount: useMeasuredCount ? measuredItemCount(itemIds, heights) : 0,
        scrollEpsilon: SCROLL_EPSILON,
        scrollHeight: Hdom,
      })
      const chase = grew && trusted && shouldChaseFollowBottomOnResize({
        clientHeight: viewportHeight,
        maxScrollTop,
        scrollEpsilon: SCROLL_EPSILON,
        scrollTop,
      })
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

    it('pre-fix rounding drift stalls the content chase above the bottom', () => {
      const result = simulateRoundedHeightGrowth({
        growth: 10,
        itemCount: 10,
        trueHeight: 332.4,
        useMeasuredCount: false,
        viewportHeight: 800,
      })

      expect(result.Hdom - result.estimatedHeight).toBeCloseTo(4)
      expect(result.trusted).toBe(false)
      expect(result.chase).toBe(false)
      expect(result.distanceFromEnd).toBe(10)
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

    it('post-drag stale placeholders stall until they re-render at default height', () => {
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
      expect(stalled[8]?.chase).toBe(false)
      expect(stalled.at(-1)?.distanceFromEnd).toBeGreaterThan(0)

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
