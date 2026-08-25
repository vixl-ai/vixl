const resolveHtmlElement = (value: unknown): HTMLElement | null => {
  if (value instanceof HTMLElement) {
    return value
  }
  if (value && typeof value === 'object' && '$el' in value) {
    const el = (value as { $el: unknown }).$el
    if (el instanceof HTMLElement) {
      return el
    }
  }
  return null
}

export default resolveHtmlElement
