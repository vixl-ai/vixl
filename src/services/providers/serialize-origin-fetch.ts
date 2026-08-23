type QueueEntry = {
  signal: AbortSignal | undefined
  abortListener: (() => void) | undefined
  settled: boolean
  resolve: () => void
  reject: (error: DOMException) => void
}

type OriginGate = {
  inFlight: boolean
  pending: QueueEntry[]
}

const gates = new Map<string, OriginGate>()

const abortError = (): DOMException =>
  new DOMException('The operation was aborted.', 'AbortError')

const normalizeOriginKey = (originKey: string): string => {
  try {
    return new URL(originKey).origin
  } catch {
    return originKey
  }
}

const getGate = (key: string): OriginGate => {
  const existing = gates.get(key)
  if (existing) {
    return existing
  }
  const created: OriginGate = { inFlight: false, pending: [] }
  gates.set(key, created)
  return created
}

const detachAbort = (entry: QueueEntry): void => {
  if (!entry.signal || !entry.abortListener) {
    return
  }
  entry.signal.removeEventListener('abort', entry.abortListener)
  entry.abortListener = undefined
}

const settleReject = (entry: QueueEntry, error: DOMException): void => {
  if (entry.settled) {
    return
  }
  entry.settled = true
  detachAbort(entry)
  entry.reject(error)
}

const settleResolve = (entry: QueueEntry): void => {
  if (entry.settled) {
    return
  }
  entry.settled = true
  detachAbort(entry)
  entry.resolve()
}

const promote = (key: string): void => {
  const gate = getGate(key)
  while (gate.pending.length > 0) {
    const next = gate.pending.shift()
    if (!next) {
      break
    }
    if (next.signal?.aborted) {
      settleReject(next, abortError())
      continue
    }
    settleResolve(next)
    return
  }
  gate.inFlight = false
}

const acquire = (key: string, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const gate = getGate(key)
    const entry: QueueEntry = {
      signal,
      abortListener: undefined,
      settled: false,
      resolve,
      reject,
    }
    const onAbort = (): void => {
      const index = gate.pending.indexOf(entry)
      if (index !== -1) {
        gate.pending.splice(index, 1)
      }
      settleReject(entry, abortError())
    }
    if (signal) {
      entry.abortListener = onAbort
      signal.addEventListener('abort', onAbort, { once: true })
    }
    if (!gate.inFlight) {
      gate.inFlight = true
      settleResolve(entry)
      return
    }
    gate.pending.push(entry)
  })

const holdUntilBodySettled = (
  response: Response,
  releaseOnce: () => void,
): Response => {
  const body = response.body
  if (!body) {
    releaseOnce()
    return response
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  body.pipeTo(writable).then(releaseOnce, releaseOnce)
  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export default (inner: typeof fetch, originKey: string): typeof fetch => {
  const key = normalizeOriginKey(originKey)
  const serialized: typeof fetch = async (input, init) => {
    await acquire(key, init?.signal ?? undefined)
    let released = false
    const releaseOnce = (): void => {
      if (released) {
        return
      }
      released = true
      promote(key)
    }
    try {
      const response = await inner(input, init)
      return holdUntilBodySettled(response, releaseOnce)
    } catch (error) {
      releaseOnce()
      throw error
    }
  }
  return serialized
}
