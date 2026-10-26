export function observeContentBoxResize(
  content: Element,
  onResize: () => void,
): ResizeObserver | null {
  if (typeof ResizeObserver === "undefined")
    return null
  const observer = new ResizeObserver(() => {
    onResize()
  })
  observer.observe(content)
  return observer
}
