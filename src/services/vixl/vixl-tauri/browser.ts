import type { CefBounds } from '@/types/browser/cef-bounds'
import { call } from './helpers'

export const browserCefCreate = (bounds: CefBounds): Promise<string> =>
  call('browser_cef_create', { bounds })

export const browserCefDestroy = (sessionId: string): Promise<void> =>
  call('browser_cef_destroy', { sessionId })

export const browserCefNavigate = (sessionId: string, url: string): Promise<void> =>
  call('browser_cef_navigate', { sessionId, url })

export const browserCefResize = (sessionId: string, bounds: CefBounds): Promise<void> =>
  call('browser_cef_resize', { sessionId, bounds })

export const browserCefSetPassthroughRects = (rects: CefBounds[]): Promise<void> =>
  call('browser_cef_set_passthrough_rects', { rects })

export const browserCefFocus = (sessionId: string): Promise<void> =>
  call('browser_cef_focus', { sessionId })

export const browserCefGetUrl = (sessionId: string): Promise<string> =>
  call('browser_cef_get_url', { sessionId })

export const browserCefGetTitle = (sessionId: string): Promise<string> =>
  call('browser_cef_get_title', { sessionId })

export const browserCefCanGoBack = (sessionId: string): Promise<boolean> =>
  call('browser_cef_can_go_back', { sessionId })

export const browserCefCanGoForward = (sessionId: string): Promise<boolean> =>
  call('browser_cef_can_go_forward', { sessionId })

export const browserCefGoBack = (sessionId: string): Promise<void> =>
  call('browser_cef_go_back', { sessionId })

export const browserCefGoForward = (sessionId: string): Promise<void> =>
  call('browser_cef_go_forward', { sessionId })

export const browserCefReload = (sessionId: string): Promise<void> =>
  call('browser_cef_reload', { sessionId })

export const browserCefGetCdpWsUrl = (sessionId: string): Promise<string> =>
  call('browser_cef_get_cdp_ws_url', { sessionId })

export const browserCefLastWarmInitError = (): Promise<string | null> =>
  call('browser_cef_last_warm_init_error')

export const browserCefCdpEndpoint = (): Promise<string> => call('browser_cef_cdp_endpoint')

export const browserCefBench = (
  iterations: number,
): Promise<{
  iterations: number
  createMs: number[]
  destroyMs: number[]
  avgCreateMs: number
  avgDestroyMs: number
}> => call('browser_cef_bench', { iterations })
