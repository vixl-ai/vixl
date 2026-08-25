import { Channel, invoke } from '@tauri-apps/api/core'
import { toast } from 'vue-sonner'
import shouldStreamRequest from '@/services/providers/should-stream-request'
import { httpProxyRequest, isTauri } from '@/services/vixl/vixl-tauri'

type HttpProxyStreamEvent =
  | { kind: 'headers'; status: number; headers: Record<string, string> }
  | { kind: 'chunk'; bytes: number[] }
  | { kind: 'end' }
  | { kind: 'error'; message: string }

const toHeaderRecord = (headers?: HeadersInit): Record<string, string> => {
  if (!headers) {
    return {}
  }
  const record: Record<string, string> = {}
  const parsed = new Headers(headers)
  parsed.forEach((value, key) => {
    record[key] = value
  })
  return record
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

const abortError = (): DOMException =>
  new DOMException('The operation was aborted.', 'AbortError')

const streamProxyFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const signal = init?.signal
  if (signal?.aborted) {
    throw abortError()
  }

  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = init?.method ?? 'GET'
  const headers = toHeaderRecord(init?.headers)
  const body =
    init?.body === undefined || init?.body === null
      ? undefined
      : typeof init.body === 'string'
        ? init.body
        : await new Response(init.body).text()
  const requestId = crypto.randomUUID()

  let status = 0
  let responseHeaders = new Headers()
  let headersSettled = false
  let resolveHeaders: (() => void) | null = null
  let rejectHeaders: ((error: Error) => void) | null = null
  const headersReady = new Promise<void>((resolve, reject) => {
    resolveHeaders = resolve
    rejectHeaders = reject
  })

  const settleHeadersError = (error: Error): void => {
    if (headersSettled) {
      return
    }
    headersSettled = true
    rejectHeaders?.(error)
  }

  const settleHeadersOk = (): void => {
    if (headersSettled) {
      return
    }
    headersSettled = true
    resolveHeaders?.()
  }

  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  let cancelled = false

  const cancelUpstream = (): void => {
    if (cancelled) {
      return
    }
    cancelled = true
    invoke('http_proxy_stream_cancel', { requestId }).catch((error) => {
      if (streamController === null) {
        return
      }
      toast.error('Failed to cancel proxy stream', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    })
  }

  const onAbort = (): void => {
    cancelUpstream()
    settleHeadersError(abortError())
    try {
      streamController?.error(abortError())
    } catch {
      streamController = null
    }
  }

  signal?.addEventListener('abort', onAbort, { once: true })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      const channel = new Channel<HttpProxyStreamEvent>()
      channel.onmessage = (event) => {
        if (cancelled || signal?.aborted) {
          return
        }
        if (event.kind === 'headers') {
          status = event.status
          responseHeaders = new Headers(event.headers)
          settleHeadersOk()
          return
        }
        if (event.kind === 'chunk') {
          controller.enqueue(Uint8Array.from(event.bytes))
          return
        }
        if (event.kind === 'end') {
          controller.close()
          return
        }
        if (event.kind === 'error') {
          const error =
            event.message === 'Request aborted' ? abortError() : new Error(event.message)
          settleHeadersError(error)
          try {
            controller.error(error)
          } catch {
            streamController = null
          }
        }
      }

      invoke('http_proxy_stream', {
        request: { url, method, headers, body, requestId },
        onEvent: channel,
      }).catch((error: unknown) => {
        if (cancelled || signal?.aborted) {
          settleHeadersError(abortError())
          return
        }
        const err = toError(error)
        settleHeadersError(err)
        try {
          controller.error(err)
        } catch {
          streamController = null
        }
      })
    },
    cancel() {
      cancelUpstream()
    },
  })

  try {
    await headersReady
  } catch (error) {
    signal?.removeEventListener('abort', onAbort)
    throw error
  }

  if (signal?.aborted) {
    cancelUpstream()
    throw abortError()
  }

  return new Response(stream, {
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    headers: responseHeaders,
  })
}

const bufferedProxyFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const signal = init?.signal
  if (signal?.aborted) {
    throw abortError()
  }

  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = init?.method ?? 'GET'
  const headers = toHeaderRecord(init?.headers)
  const body =
    init?.body === undefined || init?.body === null
      ? undefined
      : typeof init.body === 'string'
        ? init.body
        : await new Response(init.body).text()
  const requestId = crypto.randomUUID()
  let cancelled = false

  const cancelUpstream = (): void => {
    if (cancelled) {
      return
    }
    cancelled = true
    invoke('http_proxy_stream_cancel', { requestId }).catch((error) => {
      toast.error('Failed to cancel proxy request', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    })
  }

  let rejectAborted: ((error: DOMException) => void) | null = null
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject
  })
  // Request may win the race; ignore a late abort rejection.
  aborted.catch(() => undefined)

  const onAbort = (): void => {
    cancelUpstream()
    rejectAborted?.(abortError())
  }

  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const result = await Promise.race([
      httpProxyRequest({
        url,
        method,
        headers,
        body,
        requestId,
      }),
      aborted,
    ])

    if (cancelled || signal?.aborted) {
      throw abortError()
    }

    const responseHeaders = new Headers(result.headers)
    if (!responseHeaders.has('content-type')) {
      const isSse = result.body.includes('data: ') && result.body.includes('\n\n')
      responseHeaders.set(
        'content-type',
        isSse ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8',
      )
    }

    return new Response(result.body, {
      status: result.status,
      statusText: result.status >= 400 ? 'Error' : 'OK',
      headers: responseHeaders,
    })
  } catch (error) {
    if (cancelled || signal?.aborted) {
      throw abortError()
    }
    const err = toError(error)
    if (err.message === 'Request aborted') {
      throw abortError()
    }
    throw err
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

const proxyFetch: typeof fetch = async (input, init) => {
  const method = init?.method ?? 'GET'
  const body =
    init?.body === undefined || init?.body === null
      ? undefined
      : typeof init.body === 'string'
        ? init.body
        : await new Response(init.body).text()

  if (shouldStreamRequest(method, init?.headers, body)) {
    return streamProxyFetch(input, {
      ...init,
      method,
      body,
      headers: init?.headers,
    })
  }

  return bufferedProxyFetch(input, {
    ...init,
    method,
    body,
    headers: init?.headers,
  })
}

export default (): typeof fetch => (isTauri() ? proxyFetch : fetch)
