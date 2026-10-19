import { describe, expect, it } from 'vitest'
import {
  computeWindowedIds,
  DEFAULT_ITEM_HEIGHT,
  DEFAULT_OVERSCAN_PX,
  estimateItemsHeight,
  shouldChaseFollowBottomForResizeSource,
  shouldChaseFollowBottomOnResize,
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
 * Production guards (width invalidation plus viewport-only chase) must
 * converge without streaming and without widening the pane after ignition.
 */

const SCROLL_EPSILON = 0.5
const SCROLL_EDGE_THRESHOLD = 8

type ResizeSource = 'content' | 'viewport'

interface SimulatorOptions {
  chaseContentResize?: boolean
  frames: number
  gap: number
  itemCount: number
  invalidateOnWidthChange?: boolean
  oldHeight: number
  overscanPx: number
  reportPolicy: 'raceUnmount' | 'allMounted'
  stopContentChaseAfterFrames?: number
  trueHeight: number
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

function applyFixedGuards(): Pick<SimulatorOptions, 'chaseContentResize' | 'invalidateOnWidthChange'> {
  return {
    chaseContentResize: false,
    invalidateOnWidthChange: true,
  }
}

function simulateFollowBottomWidthChange({
  chaseContentResize = true,
  frames,
  gap,
  itemCount,
  invalidateOnWidthChange = false,
  oldHeight,
  overscanPx,
  reportPolicy,
  stopContentChaseAfterFrames,
  trueHeight,
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
  let allowContentChase = chaseContentResize
  let shouldClearHeightsOnWidth = invalidateOnWidthChange

  const framesOut: FrameOut[] = []

  for (let frame = 0; frame < frames; frame += 1) {
    if (
      stopContentChaseAfterFrames !== undefined
      && frame === stopContentChaseAfterFrames
    ) {
      allowContentChase = false
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

    let Hdom = 0
    for (let index = 0; index < itemCount; index += 1) {
      const id = itemIds[index]
      if (!id)
        continue
      Hdom += mounted.has(id) ? trueHeight : (heights.get(id) ?? DEFAULT_ITEM_HEIGHT)
      if (index < itemCount - 1)
        Hdom += gap
    }

    const maxScrollTop = Math.max(0, Hdom - viewportHeight)
    const beforeClamp = scrollTop
    if (scrollTop > maxScrollTop)
      scrollTop = maxScrollTop
    const clamped = scrollTop !== beforeClamp
    const source: ResizeSource = frame === 0 ? 'viewport' : 'content'
    const allowChase = allowContentChase
      || shouldChaseFollowBottomForResizeSource({ source })
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
        heights.set(id, trueHeight)
    }
    else {
      for (const id of nextMounted) {
        if (mounted.has(id))
          heights.set(id, trueHeight)
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

  describe('fixed guards (width invalidation plus viewport-only chase)', () => {
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
      expect(framesOut.slice(1).every((frame) => frame.chase === false)).toBe(true)
      expect(framesOut.at(-1)).toMatchObject({
        Hdom: 3776,
        distanceFromEnd: 0,
        mountedKey: '14,15,16,17,18,19',
        scrollTop: 3376,
        settle: true,
      })

      const withoutInvalidation = simulateFollowBottomWidthChange({
        chaseContentResize: false,
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
      expect(framesOut.slice(1).every((frame) => frame.chase === false)).toBe(true)
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
        frames: 16,
        reportPolicy: 'raceUnmount',
        stopContentChaseAfterFrames: 8,
        ...scenario20,
      })

      const ignited = framesOut.slice(0, 8)
      expect(isTwoCycle(ignited)).toBe(true)

      const afterFix = framesOut.slice(8)
      expectConverged(afterFix)
      expect(afterFix.every((frame) => frame.source === 'content')).toBe(true)
      expect(afterFix.every((frame) => frame.chase === false)).toBe(true)
    })
  })
})
