import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import createBrowserTabSessionView from '@/composables/create-browser-tab-session-view'
import { BROWSER_HIDDEN_BOUNDS } from '@/utils/browser-session-storage'
import type { CefBounds } from '@/types/browser/cef-bounds'

const browserCefResize = vi.hoisted(
  () => vi.fn<(sessionId: string, bounds: CefBounds) => Promise<void>>(),
)
const browserCefDestroy = vi.hoisted(
  () => vi.fn<(sessionId: string) => Promise<void>>(),
)
const unregisterCefSession = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
const syncBrowserPassthroughRects = vi.hoisted(
  () =>
    vi.fn<(args: {
      enabled: boolean
      hostEl: HTMLElement | null
      lastBounds: CefBounds | null
    }) => Promise<void>>(),
)
const readBrowserHostBounds = vi.hoisted(
  () => vi.fn<(el: HTMLElement | null) => CefBounds | null>(),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/services/vixl/vixl-tauri/browser', () => ({
  browserCefResize: (
    sessionId: string,
    bounds: CefBounds,
  ) => browserCefResize(sessionId, bounds),
  browserCefDestroy: (sessionId: string) => browserCefDestroy(sessionId),
}))

vi.mock('@/services/browser/registry', () => ({
  unregisterCefSession: (sessionId: string) => unregisterCefSession(sessionId),
}))

vi.mock('@/utils/sync-browser-passthrough-rects', () => ({
  default: (
    args: {
      enabled: boolean
      hostEl: HTMLElement | null
      lastBounds: CefBounds | null
    },
  ) => syncBrowserPassthroughRects(args),
}))

vi.mock('@/utils/browser-host-bounds', () => ({
  default: (el: HTMLElement | null) => readBrowserHostBounds(el),
}))

const hostBounds: CefBounds = { x: 1, y: 2, width: 100, height: 50 }

describe('create-browser-tab-session-view', () => {
  let sessionId: string | null
  let created: boolean
  let cefReady: boolean
  let lastBounds: CefBounds | null
  let stopPolling: ReturnType<typeof vi.fn<() => void>>

  const createView = () =>
    createBrowserTabSessionView({
      getSessionId: () => sessionId,
      isCreated: () => created,
      isTabActive: () => true,
      getHostEl: () => null,
      getLastBounds: () => lastBounds,
      setLastBounds: (bounds) => {
        lastBounds = bounds
      },
      clearSessionId: () => {
        sessionId = null
      },
      setSessionId: (next) => {
        sessionId = next
      },
      setCreated: (value) => {
        created = value
      },
      setCefReady: (value) => {
        cefReady = value
      },
      stopPolling,
      syncPassthroughRects: async () => undefined,
    })

  beforeEach(() => {
    sessionId = '1'
    created = true
    cefReady = true
    lastBounds = null
    stopPolling = vi.fn<() => void>()
    browserCefResize.mockReset()
    browserCefDestroy.mockReset()
    unregisterCefSession.mockReset()
    syncBrowserPassthroughRects.mockReset()
    readBrowserHostBounds.mockReset()
    vi.mocked(toast.error).mockReset()
    browserCefResize.mockResolvedValue(undefined)
    browserCefDestroy.mockResolvedValue(undefined)
    syncBrowserPassthroughRects.mockResolvedValue(undefined)
    readBrowserHostBounds.mockReturnValue(hostBounds)
  })

  it('clears the local session id before native destroy', async () => {
    const order: string[] = []
    const view = createView()
    browserCefDestroy.mockImplementation(async () => {
      order.push(`destroy:${sessionId}`)
    })
    await view.destroyCefSession()
    expect(order).toEqual(['destroy:null'])
    expect(sessionId).toBeNull()
    expect(created).toBe(false)
    expect(cefReady).toBe(false)
    expect(syncBrowserPassthroughRects).toHaveBeenCalledWith({
      enabled: false,
      hostEl: null,
      lastBounds: null,
    })
  })

  it('does not toast when hiding a missing or unknown session', async () => {
    const view = createView()
    sessionId = null
    await view.hideCefView()
    expect(browserCefResize).not.toHaveBeenCalled()
    expect(syncBrowserPassthroughRects).toHaveBeenCalledWith({
      enabled: false,
      hostEl: null,
      lastBounds: null,
    })
    expect(toast.error).not.toHaveBeenCalled()

    sessionId = '1'
    browserCefResize.mockRejectedValue(new Error('unknown CEF session 1'))
    await view.hideCefView()
    expect(toast.error).not.toHaveBeenCalled()
    expect(syncBrowserPassthroughRects).toHaveBeenCalledTimes(2)
  })

  it('does not toast when resizing an unknown session', async () => {
    const view = createView()
    browserCefResize.mockRejectedValue(new Error('unknown CEF session 1'))
    await view.resizeToHost()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not toast when hiding a previous unknown session', async () => {
    const view = createView()
    browserCefResize.mockRejectedValue(new Error('unknown CEF session 1'))
    await view.switchToSession('2')
    expect(browserCefResize).toHaveBeenCalledWith('1', BROWSER_HIDDEN_BOUNDS)
    expect(toast.error).not.toHaveBeenCalled()
    expect(sessionId).toBe('2')
  })

  it('skips native hide after detach', async () => {
    const view = createView()
    await view.detachActiveSession()
    expect(stopPolling).toHaveBeenCalled()
    expect(sessionId).toBeNull()
    expect(created).toBe(false)
    expect(cefReady).toBe(false)
    expect(browserCefResize).not.toHaveBeenCalled()
    expect(syncBrowserPassthroughRects).toHaveBeenCalledWith({
      enabled: false,
      hostEl: null,
      lastBounds: null,
    })
  })
})
