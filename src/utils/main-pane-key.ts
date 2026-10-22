export type MainPaneRoute = {
  path: string
  params: Record<string, string | string[] | undefined>
  query?: Record<string, unknown>
}

export type MainPaneFadeOptions = {
  reducedMotion: boolean
  hasViewTransition: boolean
  transitionInFlight: boolean
}

const paramString = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : ''

export const mainPaneKey = (route: MainPaneRoute): string => {
  const chatId = paramString(route.params.chatId)
  if (!chatId) {
    return route.path
  }
  const slug = paramString(route.params.slug)
  return `chat:${slug || 'home'}:${chatId}`
}

export const shouldFadeMainPane = (
  from: MainPaneRoute,
  to: MainPaneRoute,
  options: MainPaneFadeOptions,
): boolean => {
  if (
    options.reducedMotion ||
    !options.hasViewTransition ||
    options.transitionInFlight
  ) {
    return false
  }
  return mainPaneKey(from) !== mainPaneKey(to)
}
