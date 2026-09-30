export const TRANSIENT_MAX_RETRIES = 2

const TRANSIENT_BACKOFF_MS = [2_000, 6_000] as const

const LAST_TRANSIENT_BACKOFF_MS = TRANSIENT_BACKOFF_MS.at(-1) ?? 6_000

export const transientBackoffMs = (attempt: number): number =>
  TRANSIENT_BACKOFF_MS[attempt] ?? LAST_TRANSIENT_BACKOFF_MS

const TRANSIENT_MARKERS = [
  'error sending request',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'socket hang up',
  'fetch failed',
  'network',
  'Failed after',
  'GatewayResponseError',
] as const

const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504])

const HARNESS_ABORT_MESSAGES = new Set(['Subagent aborted', 'Chat aborted'])

const VALIDATION_OR_TOOL_NAME =
  /validation|invalid.?tool|invalid.?argument|invalid.?prompt|invalid.?input/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readString = (value: unknown): string =>
  typeof value === 'string' ? value : ''

export const isAbortLikeError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }
  if (!isRecord(error)) {
    return false
  }
  const name = readString(error.name)
  if (
    name === 'AbortError' ||
    name === 'ResponseAborted'
  ) {
    return true
  }
  if (error.reason === 'abort') {
    return true
  }
  return HARNESS_ABORT_MESSAGES.has(readString(error.message))
}

const isValidationOrToolNode = (error: unknown): boolean => {
  if (!isRecord(error)) {
    return false
  }
  return VALIDATION_OR_TOOL_NAME.test(readString(error.name))
}

const readStatus = (error: unknown): number | undefined => {
  if (!isRecord(error)) {
    return undefined
  }
  if (typeof error.statusCode === 'number') {
    return error.statusCode
  }
  if (typeof error.status === 'number') {
    return error.status
  }
  return undefined
}

const collectErrorNodes = (
  error: unknown,
  seen: Set<unknown> = new Set(),
): unknown[] => {
  if (error == null || seen.has(error)) {
    return []
  }
  if (typeof error !== 'object' && typeof error !== 'string') {
    return []
  }
  seen.add(error)
  const nodes: unknown[] = [error]
  if (!isRecord(error)) {
    return nodes
  }
  if (error.cause !== undefined) {
    nodes.push(...collectErrorNodes(error.cause, seen))
  }
  if (error.lastError !== undefined) {
    nodes.push(...collectErrorNodes(error.lastError, seen))
  }
  if (Array.isArray(error.errors)) {
    for (const nested of error.errors) {
      nodes.push(...collectErrorNodes(nested, seen))
    }
  }
  return nodes
}

const nodeText = (error: unknown): string => {
  if (typeof error === 'string') {
    return error
  }
  if (!isRecord(error)) {
    return ''
  }
  return `${readString(error.name)} ${readString(error.message)}`
}

const nodeLooksTransient = (error: unknown): boolean => {
  const status = readStatus(error)
  if (status !== undefined && TRANSIENT_STATUS_CODES.has(status)) {
    return true
  }
  const haystack = nodeText(error).toLowerCase()
  return TRANSIENT_MARKERS.some((marker) =>
    haystack.includes(marker.toLowerCase()),
  )
}

export const isTransientError = (error: unknown): boolean => {
  const nodes = collectErrorNodes(error)
  if (nodes.some(isAbortLikeError) || nodes.some(isValidationOrToolNode)) {
    return false
  }
  return nodes.some(nodeLooksTransient)
}

export const waitAbortAware = (
  ms: number,
  signal: AbortSignal,
  abortMessage: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(abortMessage))
      return
    }
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      action()
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      finish(() => {
        reject(new Error(abortMessage))
      })
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      finish(resolve)
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
