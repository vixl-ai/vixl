import { describe, expect, it, vi } from 'vitest'
import serializeOriginFetch from '@/services/providers/serialize-origin-fetch'

const readAll = async (response: Response): Promise<string> => response.text()

describe('serializeOriginFetch', () => {
  it('starts the second same-origin fetch only after the first body is fully read', async () => {
    const innerCalls: string[] = []
    let closeFirst: (() => void) | undefined
    const inner = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      innerCalls.push(url)
      if (url.endsWith('/one')) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              closeFirst = () => {
                controller.enqueue(new TextEncoder().encode('first'))
                controller.close()
              }
            },
          }),
        )
      }
      return new Response('second')
    })

    const fetch = serializeOriginFetch(inner, 'http://192.168.0.12:8000/v1')
    const firstPending = fetch('http://192.168.0.12:8000/v1/one')
    const secondPending = fetch('http://192.168.0.12:8000/v1/two')

    const firstResponse = await firstPending
    await Promise.resolve()
    expect(innerCalls).toEqual(['http://192.168.0.12:8000/v1/one'])

    closeFirst?.()
    expect(await readAll(firstResponse)).toBe('first')

    const secondResponse = await secondPending
    expect(innerCalls).toEqual([
      'http://192.168.0.12:8000/v1/one',
      'http://192.168.0.12:8000/v1/two',
    ])
    expect(await readAll(secondResponse)).toBe('second')
  })

  it('does not block fetches for different origin keys', async () => {
    const started: string[] = []
    const releaseByUrl = new Map<string, () => void>()
    const inner = vi.fn<typeof fetch>(
      (input) =>
        new Promise<Response>((resolve) => {
          const url = String(input)
          started.push(url)
          releaseByUrl.set(url, () => resolve(new Response(url)))
        }),
    )

    const fetchA = serializeOriginFetch(inner, 'http://192.168.0.12:8000/v1')
    const fetchB = serializeOriginFetch(inner, 'http://127.0.0.1:9000/v1')
    const pendingA = fetchA('http://192.168.0.12:8000/v1/a')
    const pendingB = fetchB('http://127.0.0.1:9000/v1/b')

    await vi.waitFor(() => {
      expect(started).toHaveLength(2)
    })

    releaseByUrl.get('http://192.168.0.12:8000/v1/a')?.()
    releaseByUrl.get('http://127.0.0.1:9000/v1/b')?.()
    const [responseA, responseB] = await Promise.all([pendingA, pendingB])
    await Promise.all([readAll(responseA), readAll(responseB)])
  })

  it('rejects with AbortError while queued and never calls inner', async () => {
    let finishFirst: ((response: Response) => void) | undefined
    const inner = vi.fn<typeof fetch>(
      (input) =>
        new Promise<Response>((resolve) => {
          if (String(input).endsWith('/hold')) {
            finishFirst = resolve
            return
          }
          resolve(new Response('should-not-run'))
        }),
    )

    const fetch = serializeOriginFetch(inner, 'http://192.168.0.12:8000')
    const firstPending = fetch('http://192.168.0.12:8000/hold')
    await vi.waitFor(() => {
      expect(inner).toHaveBeenCalledTimes(1)
    })

    const controller = new AbortController()
    const queued = fetch('http://192.168.0.12:8000/queued', {
      signal: controller.signal,
    })
    controller.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(inner).toHaveBeenCalledTimes(1)

    finishFirst?.(new Response('held'))
    expect(await readAll(await firstPending)).toBe('held')
  })

  it('releases the slot when inner throws so a later fetch can run', async () => {
    const inner = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('upstream failed'))
      .mockResolvedValueOnce(new Response('recovered'))

    const fetch = serializeOriginFetch(inner, 'http://192.168.0.12:8000/v1')
    await expect(fetch('http://192.168.0.12:8000/v1/fail')).rejects.toThrow(
      'upstream failed',
    )

    const recovered = await fetch('http://192.168.0.12:8000/v1/ok')
    expect(await readAll(recovered)).toBe('recovered')
    expect(inner).toHaveBeenCalledTimes(2)
  })
})
