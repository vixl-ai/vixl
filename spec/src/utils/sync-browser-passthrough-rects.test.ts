import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CefBounds } from '@/types/browser/cef-bounds'

const browserCefSetPassthroughRects = vi.hoisted(() =>
  vi.fn<(rects: CefBounds[]) => Promise<void>>(),
)

vi.mock('@/services/vixl/vixl-tauri/browser', () => ({
  browserCefSetPassthroughRects,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

import syncBrowserPassthroughRects from '@/utils/sync-browser-passthrough-rects'

const createHost = (width: number, height: number): HTMLElement => {
  return {
    getBoundingClientRect: () => ({
      x: 40,
      y: 80,
      left: 40,
      top: 80,
      right: 40 + width,
      bottom: 80 + height,
      width,
      height,
      toJSON: () => ({}),
    }),
  } as HTMLElement
}

describe('syncBrowserPassthroughRects', () => {
  beforeEach(() => {
    browserCefSetPassthroughRects.mockReset()
    browserCefSetPassthroughRects.mockResolvedValue(undefined)
  })

  it('ignores an older in-flight enabled sync after a later clear', async () => {
    const host = createHost(320, 240)
    const liveBounds: CefBounds = { x: 40, y: 80, width: 320, height: 240 }

    let releaseEnabled!: () => void
    const enabledGate = new Promise<void>((resolve) => {
      releaseEnabled = resolve
    })

    browserCefSetPassthroughRects.mockImplementation(async (rects) => {
      if (rects.length > 0) {
        await enabledGate
      }
    })

    const enabledSync = syncBrowserPassthroughRects({
      enabled: true,
      hostEl: host,
      lastBounds: { x: 1, y: 2, width: 3, height: 4 },
    })

    // Allow the enabled apply to start and block on the gate.
    await Promise.resolve()
    await Promise.resolve()

    const clearSync = syncBrowserPassthroughRects({
      enabled: false,
      hostEl: null,
      lastBounds: null,
    })

    releaseEnabled()
    await Promise.all([enabledSync, clearSync])

    const calls = browserCefSetPassthroughRects.mock.calls.map(([rects]) => rects)
    expect(calls.at(-1)).toEqual([])
    // Stale enabled completion must not be the final published hole.
    expect(calls.at(-1)).not.toEqual([liveBounds])
  })

  it('skips applying when a newer clear starts before the older apply runs', async () => {
    const host = createHost(320, 240)

    // Enqueue enabled then clear in the same turn so generation advances before
    // either write-chain apply runs. The older enabled apply must skip IPC.
    const enabledSync = syncBrowserPassthroughRects({
      enabled: true,
      hostEl: host,
      lastBounds: { x: 1, y: 2, width: 3, height: 4 },
    })
    const clearSync = syncBrowserPassthroughRects({
      enabled: false,
      hostEl: null,
      lastBounds: null,
    })

    await Promise.all([enabledSync, clearSync])

    expect(browserCefSetPassthroughRects).toHaveBeenCalledTimes(1)
    expect(browserCefSetPassthroughRects).toHaveBeenCalledWith([])
  })

  it('publishes empty rects when enabled but the host has no measurable size', async () => {
    const zeroHost = createHost(0, 0)
    const lastBounds: CefBounds = { x: 12, y: 34, width: 560, height: 400 }

    await syncBrowserPassthroughRects({
      enabled: true,
      hostEl: zeroHost,
      lastBounds,
    })

    expect(browserCefSetPassthroughRects).toHaveBeenCalledTimes(1)
    expect(browserCefSetPassthroughRects).toHaveBeenCalledWith([])
    expect(browserCefSetPassthroughRects).not.toHaveBeenCalledWith([lastBounds])
  })
})
