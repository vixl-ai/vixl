import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type CdpClient from '@/services/browser/cdp-client'
import type { ScreenshotResult } from '@/types/browser/screenshot-result'

const takeScreenshot = vi.hoisted(() =>
  vi.fn<(client: CdpClient, sessionId: string) => Promise<ScreenshotResult>>(),
)
const hardReload = vi.hoisted(() =>
  vi.fn<(client: CdpClient, sessionId: string) => Promise<void>>(),
)
const reload = vi.hoisted(() =>
  vi.fn<(client: CdpClient, sessionId: string) => Promise<void>>(),
)
const resetNavigationHistory = vi.hoisted(() =>
  vi.fn<(client: CdpClient, sessionId: string) => Promise<void>>(),
)
const clearCookiesForActiveOrigin = vi.hoisted(() =>
  vi.fn<(client: CdpClient, sessionId: string) => Promise<void>>(),
)
const clearCacheForActiveOrigin = vi.hoisted(() =>
  vi.fn<(client: CdpClient, sessionId: string) => Promise<void>>(),
)
const saveScreenshot = vi.hoisted(() =>
  vi.fn<(bytes: Uint8Array) => Promise<{ mimeType: string; path: string }>>(),
)
const revealInFolder = vi.hoisted(() =>
  vi.fn<(path: string) => Promise<void>>(),
)
const clipboardWriteText = vi.hoisted(() =>
  vi.fn<(text: string) => Promise<void>>(),
)

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => string | number>(() => 'info-toast-id'),
  },
}))

vi.mock('@/services/browser/cdp-screenshot', () => ({
  takeScreenshot: (...args: [CdpClient, string]) => takeScreenshot(...args),
}))

vi.mock('@/services/browser/cdp-navigation', () => ({
  hardReload: (...args: [CdpClient, string]) => hardReload(...args),
  reload: (...args: [CdpClient, string]) => reload(...args),
  resetNavigationHistory: (...args: [CdpClient, string]) =>
    resetNavigationHistory(...args),
}))

vi.mock('@/services/browser/cdp-storage', () => ({
  clearCookiesForActiveOrigin: (...args: [CdpClient, string]) =>
    clearCookiesForActiveOrigin(...args),
  clearCacheForActiveOrigin: (...args: [CdpClient, string]) =>
    clearCacheForActiveOrigin(...args),
}))

vi.mock('@/services/browser/screenshot-store', () => ({
  default: (...args: [Uint8Array]) => saveScreenshot(...args),
}))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  revealInFolder: (...args: [string]) => revealInFolder(...args),
}))

describe('use-browser-toolbar', () => {
  const client = {
    send: vi.fn<
      (
        method: string,
        params?: Record<string, unknown>,
        sessionId?: string,
      ) => Promise<unknown>
    >(),
    on: vi.fn<(method: string, handler: (...args: unknown[]) => void) => () => void>(),
  } as unknown as CdpClient
  let getCefSessionId: ReturnType<typeof vi.fn<() => string | null>>
  let getClient: ReturnType<typeof vi.fn<() => Promise<CdpClient>>>
  let currentUrl: Ref<string>
  const pngBytes = new Uint8Array([137, 80, 78, 71])

  beforeEach(() => {
    vi.clearAllMocks()
    getCefSessionId = vi.fn<() => string | null>(() => 'cef-session-1')
    getClient = vi.fn<() => Promise<CdpClient>>(async () => client)
    currentUrl = ref('https://example.com')
    takeScreenshot.mockResolvedValue({ data: pngBytes, mimeType: 'image/png' })
    hardReload.mockResolvedValue(undefined)
    reload.mockResolvedValue(undefined)
    resetNavigationHistory.mockResolvedValue(undefined)
    clearCookiesForActiveOrigin.mockResolvedValue(undefined)
    clearCacheForActiveOrigin.mockResolvedValue(undefined)
    saveScreenshot.mockResolvedValue({
      mimeType: 'image/png',
      path: '/tmp/vixl/screenshots/shot.png',
    })
    revealInFolder.mockResolvedValue(undefined)
    clipboardWriteText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    })
  })

  const loadComposable = async () => {
    const useBrowserToolbar = (await import('@/composables/use-browser-toolbar'))
      .default
    return useBrowserToolbar({
      currentUrl,
      getCefSessionId,
      getClient,
    })
  }

  it('screenshot success saves png and toast.success', async () => {
    const api = await loadComposable()

    await api.handleTakeScreenshot()

    expect(takeScreenshot).toHaveBeenCalledWith(client, '')
    expect(saveScreenshot).toHaveBeenCalledWith(pngBytes)
    expect(revealInFolder).toHaveBeenCalledWith(
      '/tmp/vixl/screenshots/shot.png',
    )
    expect(toast.success).toHaveBeenCalledWith('Screenshot saved', {
      description: '/tmp/vixl/screenshots/shot.png',
    })
  })

  it('screenshot no page (empty or about:blank) toasts and does not call takeScreenshot', async () => {
    const api = await loadComposable()

    currentUrl.value = ''
    await api.handleTakeScreenshot()
    currentUrl.value = 'about:blank'
    await api.handleTakeScreenshot()

    expect(takeScreenshot).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledWith('No page to screenshot')
  })

  it('screenshot with no session toasts Failed to take screenshot', async () => {
    getCefSessionId.mockReturnValue(null)
    const api = await loadComposable()

    await api.handleTakeScreenshot()

    expect(takeScreenshot).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Failed to take screenshot', {
      description: 'No active browser session',
    })
  })

  it('hard reload success calls hardReload not a soft reload', async () => {
    const api = await loadComposable()

    await api.handleHardReload()

    expect(hardReload).toHaveBeenCalledWith(client, '')
    expect(reload).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Hard reload complete')
  })

  it('hard reload no session toast.error Failed to hard reload', async () => {
    getCefSessionId.mockReturnValue(null)
    const api = await loadComposable()

    await api.handleHardReload()

    expect(hardReload).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Failed to hard reload', {
      description: 'No active browser session',
    })
  })

  it('clear history success calls resetNavigationHistory and empties historyUrls', async () => {
    const api = await loadComposable()
    api.recordHistoryUrl('https://example.com/a')
    api.recordHistoryUrl('https://example.com/b')
    expect(api.historyUrls.value).toEqual([
      'https://example.com/b',
      'https://example.com/a',
    ])

    await api.handleClearBrowsingData()

    expect(resetNavigationHistory).toHaveBeenCalledWith(client, '')
    expect(api.historyUrls.value).toEqual([])
    expect(toast.success).toHaveBeenCalledWith('Browsing history cleared')
  })

  it('clear cookies success toasts Cookies cleared', async () => {
    const api = await loadComposable()

    await api.handleClearCookies()

    expect(clearCookiesForActiveOrigin).toHaveBeenCalledWith(client, '')
    expect(toast.success).toHaveBeenCalledWith('Cookies cleared')
  })

  it('clear cache success toasts Cache cleared', async () => {
    const api = await loadComposable()

    await api.handleClearCache()

    expect(clearCacheForActiveOrigin).toHaveBeenCalledWith(client, '')
    expect(toast.success).toHaveBeenCalledWith('Cache cleared')
  })

  it('CDP failure path toast.error', async () => {
    takeScreenshot.mockRejectedValue(new Error('cdp timeout'))
    const api = await loadComposable()

    await api.handleTakeScreenshot()

    expect(toast.error).toHaveBeenCalledWith('Failed to take screenshot', {
      description: 'cdp timeout',
    })
    expect(saveScreenshot).not.toHaveBeenCalled()
    expect(revealInFolder).not.toHaveBeenCalled()
  })
})
