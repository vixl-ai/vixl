import type { ModelMessage } from 'ai'
import { throwIfAborted } from '@/services/harness/subagent/generate-support'
import { getSubagent } from '@/services/harness/subagent/registry'

export const TRANSIENT_MAX_RETRIES = 2
export const TRANSIENT_BACKOFF_MS = [2_000, 6_000] as const
const LAST_TRANSIENT_BACKOFF_MS = TRANSIENT_BACKOFF_MS.at(-1) ?? 6_000

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
  if (!isRecord(error) && !(error instanceof Error)) {
    return false
  }
  const name = readString((error as { name?: unknown }).name)
  if (
    name === 'AbortError' ||
    name === 'ResponseAborted'
  ) {
    return true
  }
  if ((error as { reason?: unknown }).reason === 'abort') {
    return true
  }
  return readString((error as { message?: unknown }).message) === 'Subagent aborted'
}

const isValidationOrToolNode = (error: unknown): boolean => {
  if (!isRecord(error) && !(error instanceof Error)) {
    return false
  }
  return VALIDATION_OR_TOOL_NAME.test(readString((error as { name?: unknown }).name))
}

const readStatus = (error: unknown): number | undefined => {
  if (!isRecord(error) && !(error instanceof Error)) {
    return undefined
  }
  const record = error as { statusCode?: unknown; status?: unknown }
  if (typeof record.statusCode === 'number') {
    return record.statusCode
  }
  if (typeof record.status === 'number') {
    return record.status
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
  if (!isRecord(error) && !(error instanceof Error)) {
    return nodes
  }
  const record = error as {
    cause?: unknown
    lastError?: unknown
    errors?: unknown
  }
  if (record.cause !== undefined) {
    nodes.push(...collectErrorNodes(record.cause, seen))
  }
  if (record.lastError !== undefined) {
    nodes.push(...collectErrorNodes(record.lastError, seen))
  }
  if (Array.isArray(record.errors)) {
    for (const nested of record.errors) {
      nodes.push(...collectErrorNodes(nested, seen))
    }
  }
  return nodes
}

const nodeText = (error: unknown): string => {
  if (typeof error === 'string') {
    return error
  }
  if (!isRecord(error) && !(error instanceof Error)) {
    return ''
  }
  const record = error as { name?: unknown; message?: unknown }
  return `${readString(record.name)} ${readString(record.message)}`
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
  if (isAbortLikeError(error)) {
    return false
  }
  const nodes = collectErrorNodes(error)
  if (nodes.some(isAbortLikeError) || nodes.some(isValidationOrToolNode)) {
    return false
  }
  return nodes.some(nodeLooksTransient)
}

export const waitAbortAware = (
  ms: number,
  signal: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Subagent aborted'))
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
        reject(new Error('Subagent aborted'))
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

export const generateTextWithTransientRetry = async <T>(args: {
  signal: AbortSignal
  subagentId: string
  generate: (messages: ModelMessage[] | undefined) => Promise<T>
}): Promise<T> => {
  let resume: ModelMessage[] | undefined
  for (let attempt = 0; attempt <= TRANSIENT_MAX_RETRIES; attempt += 1) {
    throwIfAborted(args.signal)
    try {
      return await args.generate(resume)
    } catch (error) {
      const canRetry =
        attempt < TRANSIENT_MAX_RETRIES &&
        !args.signal.aborted &&
        !isAbortLikeError(error) &&
        isTransientError(error)
      if (!canRetry) {
        throw error
      }
      await waitAbortAware(
        TRANSIENT_BACKOFF_MS[attempt] ?? LAST_TRANSIENT_BACKOFF_MS,
        args.signal,
      )
      resume = getSubagent(args.subagentId)?.messages
    }
  }
  throw new Error('Subagent generate retries exhausted')
}
