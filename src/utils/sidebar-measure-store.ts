export const heightForKey = (
  heights: ReadonlyMap<string, number>,
  key: string,
  estimate: number,
): number => heights.get(key) ?? estimate

export const recordMeasuredHeight = (
  heights: ReadonlyMap<string, number>,
  key: string,
  height: number,
): ReadonlyMap<string, number> => {
  const next = Math.ceil(height)
  if (next <= 0 || heights.get(key) === next) {
    return heights
  }
  const copy = new Map(heights)
  copy.set(key, next)
  return copy
}

export const pruneMeasuredHeights = (
  heights: ReadonlyMap<string, number>,
  keys: readonly string[],
): ReadonlyMap<string, number> => {
  if (heights.size === 0) {
    return heights
  }
  const keep = new Set(keys)
  for (const key of heights.keys()) {
    if (!keep.has(key)) {
      const next = new Map<string, number>()
      for (const [stored, storedHeight] of heights) {
        if (keep.has(stored)) {
          next.set(stored, storedHeight)
        }
      }
      return next
    }
  }
  return heights
}

export const bindMeasuredRow = <El>(
  keyToEl: Map<string, El>,
  elToKey: Map<El, string>,
  key: string,
  element: El,
): El | undefined => {
  const previous = keyToEl.get(key)
  let detached: El | undefined
  if (previous && previous !== element) {
    if (elToKey.get(previous) === key) {
      elToKey.delete(previous)
      detached = previous
    }
  }
  const occupied = elToKey.get(element)
  if (occupied && occupied !== key) {
    keyToEl.delete(occupied)
  }
  keyToEl.set(key, element)
  elToKey.set(element, key)
  return detached
}

export const unbindMeasuredRow = <El>(
  keyToEl: Map<string, El>,
  elToKey: Map<El, string>,
  key: string,
): El | undefined => {
  const previous = keyToEl.get(key)
  if (!previous) {
    return undefined
  }
  keyToEl.delete(key)
  if (elToKey.get(previous) !== key) {
    return undefined
  }
  elToKey.delete(previous)
  return previous
}
