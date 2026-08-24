import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import { mockTauriCore } from '../../test-utils/mocks/tauri-core'

const { httpProxyRequest, invoke, isTauri } = vi.hoisted(() => {
  type ProxyRequest = { requestId?: string }
  return {
    httpProxyRequest: vi.fn<(request: ProxyRequest) => Promise<unknown>>(),
    invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    isTauri: vi.fn<() => boolean>(() => true),
  }
})

vi.mock('@tauri-apps/api/core', () =>
  mockTauriCore({
    invoke: (...args: unknown[]) =>
      invoke(args[0] as string, args[1] as Record<string, unknown> | undefined),
  }),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    httpProxyRequest,
    isTauri,
  }),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<() => void>(),
  },
}))

import createProxyFetch from '@/services/providers/proxy-fetch'

describe('proxyFetch buffered abort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauri.mockReturnValue(true)
    invoke.mockResolvedValue(undefined)
  })

  it('cancels in-flight buffered requests and rejects with AbortError', async () => {
    const controller = new AbortController()

    httpProxyRequest.mockImplementation((request) => {
      expect(request.requestId).toEqual(expect.any(String))
      return new Promise(() => {
        // Stay pending until cancelled; upstream cancel is what matters.
      })
    })

    const fetch = createProxyFetch()
    const pending = fetch('http://127.0.0.1:11434/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'test', messages: [] }),
      signal: controller.signal,
    })

    await vi.waitFor(() => {
      expect(httpProxyRequest).toHaveBeenCalled()
    })

    const requestId = httpProxyRequest.mock.calls[0]?.[0]?.requestId as string
    expect(requestId).toBeTruthy()

    controller.abort()

    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    })

    expect(invoke).toHaveBeenCalledWith('http_proxy_stream_cancel', { requestId })
  })

  it('rejects with AbortError when the proxy reports Request aborted', async () => {
    httpProxyRequest.mockRejectedValue(new Error('Request aborted'))

    const fetch = createProxyFetch()
    await expect(
      fetch('http://127.0.0.1:11434/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'test', messages: [] }),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
