import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import useBrowserNavigation from '@/composables/use-browser-navigation'

const browserCefNavigate = vi.hoisted(
  () => vi.fn<(sessionId: string, url: string) => Promise<void>>(),
)
const browserCefGoBack = vi.hoisted(
  () => vi.fn<(sessionId: string) => Promise<void>>(),
)
const browserCefGoForward = vi.hoisted(
  () => vi.fn<(sessionId: string) => Promise<void>>(),
)
const browserCefReload = vi.hoisted(
  () => vi.fn<(sessionId: string) => Promise<void>>(),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/services/vixl/vixl-tauri/browser', () => ({
  browserCefNavigate: (sessionId: string, url: string) =>
    browserCefNavigate(sessionId, url),
  browserCefGoBack: (sessionId: string) => browserCefGoBack(sessionId),
  browserCefGoForward: (sessionId: string) => browserCefGoForward(sessionId),
  browserCefReload: (sessionId: string) => browserCefReload(sessionId),
}))

describe('use-browser-navigation', () => {
  const cefReady = ref(false)
  const pageUrl = ref('about:blank')
  const addressBarValue = ref('example.com')
  const addressInputRef = ref<HTMLInputElement | null>(null)
  let sessionId: string | null
  const ensureCefSession = vi.fn<() => Promise<boolean>>()
  const markNavigated = vi.fn<(url: string) => void>()
  const showCefView = vi.fn<() => Promise<void>>()
  const refreshState = vi.fn<() => Promise<void>>()
  const startPolling = vi.fn<() => void>()
  const recordHistoryUrl = vi.fn<(url: string) => void>()

  const createNav = () =>
    useBrowserNavigation({
      cefReady,
      pageUrl,
      addressBarValue,
      addressInputRef,
      ensureCefSession,
      getCefSessionId: () => sessionId,
      markNavigated,
      showCefView,
      refreshState,
      startPolling,
      recordHistoryUrl,
    })

  beforeEach(() => {
    cefReady.value = false
    pageUrl.value = 'about:blank'
    addressBarValue.value = 'example.com'
    sessionId = null
    ensureCefSession.mockReset()
    markNavigated.mockReset()
    showCefView.mockReset()
    refreshState.mockReset()
    startPolling.mockReset()
    recordHistoryUrl.mockReset()
    browserCefNavigate.mockReset()
    browserCefGoBack.mockReset()
    browserCefGoForward.mockReset()
    browserCefReload.mockReset()
    ensureCefSession.mockImplementation(async () => {
      sessionId = '3'
      cefReady.value = true
      return true
    })
    browserCefNavigate.mockResolvedValue(undefined)
    showCefView.mockResolvedValue(undefined)
    refreshState.mockResolvedValue(undefined)
  })

  it('creates a session when navigating after the last page was closed', async () => {
    const nav = createNav()
    await nav.handleNavigate()
    expect(ensureCefSession).toHaveBeenCalledTimes(1)
    expect(browserCefNavigate).toHaveBeenCalledWith('3', 'https://example.com')
    expect(showCefView).toHaveBeenCalledTimes(1)
    expect(markNavigated).toHaveBeenCalledWith('https://example.com')
    expect(showCefView.mock.invocationCallOrder[0]).toBeLessThan(
      markNavigated.mock.invocationCallOrder[0]!,
    )
  })
})
