import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type CdpClient from '@/services/browser/cdp-client'
import type { BrowserElementSelection } from '@/types/browser/browser-element-selection'

const startInspectMode = vi.fn<
  (
    client: CdpClient,
    sessionId: string,
    onPick: (backendNodeId: number) => void,
  ) => Promise<() => void>
>()
const stopInspectMode = vi.fn<
  (client: CdpClient, sessionId: string) => Promise<void>
>()
const captureElementByBackendNodeId = vi.fn<
  (
    client: CdpClient,
    sessionId: string,
    backendNodeId: number,
  ) => Promise<BrowserElementSelection>
>()
const appendBrowserElement = vi.fn<(selection: BrowserElementSelection) => void>()

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => string | number>(() => 'info-toast-id'),
    dismiss: vi.fn<(id?: string | number) => void>(),
  },
}))

vi.mock('@/services/browser/cdp-inspect-mode', () => ({
  startInspectMode: (
    ...args: [
      CdpClient,
      string,
      (backendNodeId: number) => void,
    ]
  ) => startInspectMode(...args),
  stopInspectMode: (...args: [CdpClient, string]) => stopInspectMode(...args),
}))

vi.mock('@/services/browser/capture-element-by-node', () => ({
  default: (...args: [CdpClient, string, number]) =>
    captureElementByBackendNodeId(...args),
}))

vi.mock('@/composables/use-chat-prompt-bridge', () => ({
  default: () => ({
    appendBrowserElement,
  }),
}))

const selection: BrowserElementSelection = {
  screenshotPath: '/tmp/vixl/screenshots/element.png',
  screenshotBytes: new Uint8Array([1, 2, 3]),
  detail: {
    xpath: '/html[1]/body[1]/button[1]',
    cssSelector: 'button.submit',
    role: 'button',
    name: 'Submit',
    attributes: { type: 'submit' },
    boundingBox: { x: 10, y: 20, width: 80, height: 32 },
    computedStyles: {},
    componentHint: null,
    screenshotPath: '/tmp/vixl/screenshots/element.png',
    outerHTML: null,
    innerText: null,
    pageUrl: null,
    ancestorPath: null,
    matchedCss: null,
  },
}

const flushPromises = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('use-browser-element-select', () => {
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
  const unsubscribe = vi.fn<() => void>()
  let getCefSessionId: ReturnType<typeof vi.fn<() => string | null>>
  let getClient: ReturnType<typeof vi.fn<() => Promise<CdpClient>>>
  let hasPage: Ref<boolean>

  beforeEach(() => {
    vi.clearAllMocks()
    getCefSessionId = vi.fn<() => string | null>(() => 'cef-session-1')
    getClient = vi.fn<() => Promise<CdpClient>>(async () => client)
    hasPage = ref(true)
    startInspectMode.mockResolvedValue(unsubscribe)
    stopInspectMode.mockResolvedValue(undefined)
    captureElementByBackendNodeId.mockResolvedValue(selection)
    vi.mocked(toast.info).mockReturnValue('info-toast-id')
  })

  const loadComposable = async () => {
    const useBrowserElementSelect = (
      await import('@/composables/use-browser-element-select')
    ).default
    return useBrowserElementSelect({
      workspaceId: 'ws-1',
      getCefSessionId,
      getClient,
      hasPage,
    })
  }

  it('toggle ON calls startInspectMode with page-target CDP session id', async () => {
    const api = await loadComposable()

    api.toggleElementSelect()
    await flushPromises()

    expect(startInspectMode).toHaveBeenCalledTimes(1)
    expect(startInspectMode).toHaveBeenCalledWith(
      client,
      '',
      expect.any(Function),
    )
    expect(toast.info).toHaveBeenCalledWith('Click an element in the browser')
    expect(api.elementSelectMode.value).toBe(true)
  })

  it('onPick captures the node, appends to composer, and exits select mode', async () => {
    const api = await loadComposable()

    api.toggleElementSelect()
    await flushPromises()

    const onPick = startInspectMode.mock.calls[0]?.[2] as (
      backendNodeId: number,
    ) => void
    onPick(42)
    await flushPromises()

    expect(stopInspectMode).toHaveBeenCalledWith(client, '')
    expect(captureElementByBackendNodeId).toHaveBeenCalledWith(client, '', 42)
    expect(appendBrowserElement).toHaveBeenCalledWith(selection)
    expect(toast.success).toHaveBeenCalledWith('Element added to composer')
    expect(toast.dismiss).toHaveBeenCalledWith('info-toast-id')
    expect(api.elementSelectMode.value).toBe(false)
  })

  it('toggle OFF calls stopInspectMode and dismisses the info toast', async () => {
    const api = await loadComposable()

    api.toggleElementSelect()
    await flushPromises()
    expect(api.elementSelectMode.value).toBe(true)
    expect(toast.info).toHaveBeenCalledWith('Click an element in the browser')

    api.toggleElementSelect()
    await flushPromises()

    expect(api.elementSelectMode.value).toBe(false)
    expect(stopInspectMode).toHaveBeenCalledWith(client, '')
    expect(toast.dismiss).toHaveBeenCalledWith('info-toast-id')
  })

  it('page close calls stopElementSelect', async () => {
    const api = await loadComposable()

    api.toggleElementSelect()
    await flushPromises()
    expect(api.elementSelectMode.value).toBe(true)

    hasPage.value = false
    await flushPromises()

    expect(api.elementSelectMode.value).toBe(false)
    expect(stopInspectMode).toHaveBeenCalledWith(client, '')
    expect(toast.dismiss).toHaveBeenCalledWith('info-toast-id')
  })

  it('null session id toasts and does not start inspect mode', async () => {
    getCefSessionId.mockReturnValue(null)
    const api = await loadComposable()

    api.toggleElementSelect()
    await flushPromises()

    expect(startInspectMode).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('No active browser session', {
      description: 'ws-1',
    })
    expect(api.elementSelectMode.value).toBe(false)
  })

  it('error during start clears mode and toasts', async () => {
    startInspectMode.mockRejectedValue(new Error('overlay failed'))
    const api = await loadComposable()

    api.toggleElementSelect()
    await flushPromises()

    expect(api.elementSelectMode.value).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Failed to start element select', {
      description: 'overlay failed',
    })
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.dismiss).not.toHaveBeenCalled()
  })

  it('stale start race does not re-arm inspect after toggle OFF', async () => {
    let resolveStart: ((unsubscribe: () => void) => void) | undefined
    startInspectMode.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveStart = resolve
        }),
    )
    const api = await loadComposable()

    api.toggleElementSelect()
    await flushPromises()
    expect(startInspectMode).toHaveBeenCalledTimes(1)
    expect(api.elementSelectMode.value).toBe(true)

    api.toggleElementSelect()
    await flushPromises()
    expect(api.elementSelectMode.value).toBe(false)
    expect(stopInspectMode).toHaveBeenCalledTimes(1)

    resolveStart?.(unsubscribe)
    await flushPromises()

    expect(stopInspectMode).toHaveBeenCalledTimes(2)
    expect(toast.info).not.toHaveBeenCalled()
    expect(api.elementSelectMode.value).toBe(false)
  })
})
