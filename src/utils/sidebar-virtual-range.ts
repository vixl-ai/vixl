export type SidebarVirtualRange = {
  start: number
  end: number
  offset: number
  total: number
}

export const sidebarVirtualRange = (args: {
  count: number
  scrollTop: number
  viewport: number
  heightAt: (index: number) => number
  overscan?: number
}): SidebarVirtualRange => {
  const count = args.count
  if (count <= 0) {
    return { start: 0, end: 0, offset: 0, total: 0 }
  }

  const overscan = args.overscan ?? 6
  const heights: number[] = []
  const tops: number[] = []
  let total = 0
  for (let index = 0; index < count; index += 1) {
    tops.push(total)
    const height = args.heightAt(index)
    heights.push(height)
    total += height
  }

  const scrollTop = Math.max(0, args.scrollTop)
  const viewport = Math.max(0, args.viewport)
  let firstVisible = 0
  while (
    firstVisible < count &&
    tops[firstVisible]! + heights[firstVisible]! <= scrollTop
  ) {
    firstVisible += 1
  }

  const start = Math.max(0, firstVisible - overscan)
  const limit = scrollTop + viewport
  let end = firstVisible
  while (end < count && tops[end]! < limit) {
    end += 1
  }
  end = Math.min(count, end + overscan)

  return {
    start,
    end,
    offset: tops[start] ?? 0,
    total,
  }
}
