export const DEFAULT_ITEM_HEIGHT = 160
export const DEFAULT_OVERSCAN_PX = 800
export const FALLBACK_VIEWPORT_HEIGHT = 800

export function itemIdsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length)
    return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i])
      return false
  }
  return true
}

export function windowedIdSetsEqual(
  a: Set<string> | null,
  b: Set<string> | null,
): boolean {
  if (a === b)
    return true
  if (!a || !b || a.size !== b.size)
    return false
  for (const id of a) {
    if (!b.has(id))
      return false
  }
  return true
}

export function estimateItemsHeight({
  defaultHeight = DEFAULT_ITEM_HEIGHT,
  gap = 0,
  heights,
  itemIds,
  paddingEnd = 0,
  paddingStart = 0,
}: {
  defaultHeight?: number
  gap?: number
  heights: ReadonlyMap<string, number>
  itemIds: readonly string[]
  paddingEnd?: number
  paddingStart?: number
}): number {
  const count = itemIds.length
  if (count === 0)
    return paddingStart + paddingEnd
  let height = paddingStart + paddingEnd
  for (let i = 0; i < count; i += 1) {
    const id = itemIds[i]
    height += (id ? heights.get(id) : undefined) ?? defaultHeight
    if (i < count - 1)
      height += gap
  }
  return height
}

export function computeWindowedIds({
  defaultHeight = DEFAULT_ITEM_HEIGHT,
  gap = 0,
  heights,
  itemIds,
  overscanPx = DEFAULT_OVERSCAN_PX,
  paddingStart = 0,
  pinnedIds,
  scrollTop,
  viewportHeight,
}: {
  defaultHeight?: number
  gap?: number
  heights: ReadonlyMap<string, number>
  itemIds: readonly string[]
  overscanPx?: number
  paddingStart?: number
  pinnedIds?: readonly string[]
  scrollTop: number
  viewportHeight: number
}): Set<string> {
  const mounted = new Set<string>()
  const viewStart = scrollTop - overscanPx
  const viewEnd = scrollTop + viewportHeight + overscanPx
  let y = paddingStart

  for (let i = 0; i < itemIds.length; i += 1) {
    const id = itemIds[i]
    if (!id)
      continue
    const height = heights.get(id) ?? defaultHeight
    const top = y
    const bottom = y + height
    if (bottom >= viewStart && top <= viewEnd)
      mounted.add(id)
    y = bottom + gap
  }

  if (pinnedIds) {
    for (const id of pinnedIds)
      mounted.add(id)
  }

  return mounted
}
