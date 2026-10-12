const resolveTurnId = (
  turnId: string,
  turnIdRemap: ReadonlyMap<string, string> | undefined,
): string => {
  if (!turnIdRemap) {
    return turnId
  }
  const visited = new Set<string>()
  let current = turnId
  while (turnIdRemap.has(current)) {
    if (visited.has(current)) {
      return current
    }
    visited.add(current)
    const mapped = turnIdRemap.get(current)
    if (!mapped) {
      return current
    }
    current = mapped
  }
  return current
}

export default resolveTurnId
