export default (args: unknown): string | null => {
  if (!args || typeof args !== 'object') {
    return null
  }
  const path = (args as Record<string, unknown>).path
  if (typeof path !== 'string' || path.length === 0) {
    return null
  }
  return path
}
