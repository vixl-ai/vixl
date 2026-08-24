import type { CefBounds } from '@/types/browser/cef-bounds'

export const BROWSER_HIDDEN_BOUNDS: CefBounds = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
}

const LAST_URL_PREFIX = 'vixl:browser:lastUrl:'

export const writeBrowserLastUrl = (workspaceId: string, url: string): void => {
  try {
    if (!url || url === 'about:blank') {
      localStorage.removeItem(`${LAST_URL_PREFIX}${workspaceId}`)
      return
    }
    localStorage.setItem(`${LAST_URL_PREFIX}${workspaceId}`, url)
  } catch {
    return
  }
}
