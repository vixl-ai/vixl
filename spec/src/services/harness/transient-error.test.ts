import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isAbortLikeError,
  isTransientError,
  transientBackoffMs,
  waitAbortAware,
} from '@/services/harness/transient-error'

describe('isTransientError', () => {
  it.each([
    'error sending request',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'socket hang up',
    'fetch failed',
    'network',
    'Failed after 3 attempts',
    'GatewayResponseError',
  ])('matches %s', (message) => {
    expect(isTransientError(new Error(message))).toBe(true)
  })

  it('walks cause, lastError, and errors arrays', () => {
    const inner = new Error('error sending request')
    inner.name = 'GatewayResponseError'
    const outer = new Error('wrapped')
    ;(outer as Error & { cause: unknown }).cause = inner
    expect(isTransientError(outer)).toBe(true)

    const retryShaped = {
      name: 'AI_RetryError',
      message: 'Failed after 3 attempts. Last error: boom',
      reason: 'maxRetriesExceeded',
      lastError: { name: 'GatewayResponseError', message: 'error sending request' },
      errors: [{ message: 'error sending request' }],
    }
    expect(isTransientError(retryShaped)).toBe(true)
  })

  it.each([429, 502, 503, 504])('retries HTTP %s when status is present', (status) => {
    expect(isTransientError({ message: 'unavailable', statusCode: status })).toBe(
      true,
    )
    expect(isTransientError({ message: 'unavailable', status })).toBe(true)
  })

  it('does not retry unrelated HTTP statuses', () => {
    expect(isTransientError({ message: 'unavailable', statusCode: 500 })).toBe(
      false,
    )
    expect(isTransientError({ message: 'not found', statusCode: 404 })).toBe(
      false,
    )
  })

  it('does not retry abort errors', () => {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    expect(isAbortLikeError(abortError)).toBe(true)
    expect(isTransientError(abortError)).toBe(false)
    expect(isAbortLikeError(new Error('Subagent aborted'))).toBe(true)
    expect(isTransientError(new Error('Subagent aborted'))).toBe(false)
    expect(isAbortLikeError(new Error('Chat aborted'))).toBe(true)
    expect(isTransientError(new Error('Chat aborted'))).toBe(false)
  })

  it('does not retry validation or tool errors even with transient text', () => {
    const validation = new Error('error sending request')
    validation.name = 'AI_TypeValidationError'
    expect(isTransientError(validation)).toBe(false)
    const toolInput = new Error('network')
    toolInput.name = 'AI_InvalidToolInputError'
    expect(isTransientError(toolInput)).toBe(false)
  })

  it('does not retry ordinary non-transient errors', () => {
    expect(isTransientError(new Error('tool failed'))).toBe(false)
    expect(isTransientError(new Error('No model configured for subagent role'))).toBe(
      false,
    )
  })
})

describe('transientBackoffMs', () => {
  it('returns scheduled delays then the last backoff', () => {
    expect(transientBackoffMs(0)).toBe(2_000)
    expect(transientBackoffMs(1)).toBe(6_000)
    expect(transientBackoffMs(2)).toBe(6_000)
  })
})

describe('waitAbortAware', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after the delay when the signal stays open', async () => {
    const signal = new AbortController().signal
    const pending = waitAbortAware(2_000, signal, 'Subagent aborted')
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toBeUndefined()
  })

  it('rejects as soon as the signal aborts', async () => {
    const controller = new AbortController()
    const pending = waitAbortAware(6_000, controller.signal, 'Chat aborted')
    controller.abort()
    await expect(pending).rejects.toThrow('Chat aborted')
  })
})
