export const scrollOptionIntoMenu = (
  container: HTMLElement,
  option: HTMLElement,
): void => {
  const containerRect = container.getBoundingClientRect()
  const optionRect = option.getBoundingClientRect()

  if (optionRect.top < containerRect.top) {
    container.scrollTop += optionRect.top - containerRect.top
    return
  }

  if (optionRect.bottom > containerRect.bottom) {
    container.scrollTop += optionRect.bottom - containerRect.bottom
  }
}
