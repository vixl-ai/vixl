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

  it('does not reject a finished buffered request when abort fires late', async () => {
    httpProxyRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    const controller = new AbortController()
    const fetch = createProxyFetch()
    const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'test', messages: [] }),
      signal: controller.signal,
    })

    expect(response.status).toBe(200)
    controller.abort()
    await Promise.resolve()
    await Promise.resolve()
    expect(response.status).toBe(200)
  })

  it('uses http_proxy_stream when Accept includes text/event-stream', async () => {
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd !== 'http_proxy_stream') {
        return undefined
      }
      const onEvent = args?.onEvent as {
        onmessage?: (event: {
          kind: string
          status?: number
          headers?: Record<string, string>
        }) => void
      }
      onEvent.onmessage?.({
        kind: 'headers',
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
      onEvent.onmessage?.({ kind: 'end' })
      return undefined
    })

    const fetch = createProxyFetch()
    const response = await fetch('https://mcp.example/sse', {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    })

    expect(response.status).toBe(200)
    expect(httpProxyRequest).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith(
      'http_proxy_stream',
      expect.objectContaining({
        request: expect.objectContaining({
          url: 'https://mcp.example/sse',
          method: 'GET',
        }),
      }),
    )
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
