import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  generateTextWithTransientRetry,
  isAbortLikeError,
  isTransientError,
  waitAbortAware,
} from '@/services/harness/subagent/retry-transient'
import {
  register,
  resetSubagentRegistryForTests,
  setMessages,
} from '@/services/harness/subagent/registry'

const transientGateway = (): Error =>
  new Error(
    'Failed after 3 attempts GatewayResponseError error sending request',
  )

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
    expect(isTransientError(new Error('Subagent aborted'))).toBe(false)
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

describe('waitAbortAware', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after the delay when the signal stays open', async () => {
    const signal = new AbortController().signal
    const pending = waitAbortAware(2_000, signal)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toBeUndefined()
  })

  it('rejects as soon as the signal aborts', async () => {
    const controller = new AbortController()
    const pending = waitAbortAware(6_000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('Subagent aborted')
  })
})

describe('generateTextWithTransientRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSubagentRegistryForTests()
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    resetSubagentRegistryForTests()
  })

  it('resumes the next attempt from the registry snapshot', async () => {
    const snapshot: ModelMessage[] = [
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'mid-run' },
    ]
    const generate = vi.fn<(messages: ModelMessage[] | undefined) => Promise<string>>()
    generate.mockImplementationOnce(async () => {
      setMessages('sub-1', snapshot)
      throw transientGateway()
    })
    generate.mockResolvedValueOnce('recovered')

    const pending = generateTextWithTransientRetry({
      signal: new AbortController().signal,
      subagentId: 'sub-1',
      generate,
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toBe('recovered')

    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[0]?.[0]).toBeUndefined()
    expect(generate.mock.calls[1]?.[0]).toEqual(snapshot)
  })

  it('fails immediately on a non-transient error', async () => {
    const generate = vi.fn<(messages: ModelMessage[] | undefined) => Promise<string>>()
    generate.mockRejectedValueOnce(new Error('Invalid tool arguments'))

    await expect(
      generateTextWithTransientRetry({
        signal: new AbortController().signal,
        subagentId: 'sub-1',
        generate,
      }),
    ).rejects.toThrow('Invalid tool arguments')
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('does not retry abort errors', async () => {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    const generate = vi.fn<(messages: ModelMessage[] | undefined) => Promise<string>>()
    generate.mockRejectedValueOnce(abortError)

    await expect(
      generateTextWithTransientRetry({
        signal: new AbortController().signal,
        subagentId: 'sub-1',
        generate,
      }),
    ).rejects.toBe(abortError)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('exhausts two retries then throws the original error', async () => {
    const generate = vi.fn<(messages: ModelMessage[] | undefined) => Promise<string>>()
    generate.mockRejectedValue(transientGateway())

    const pending = generateTextWithTransientRetry({
      signal: new AbortController().signal,
      subagentId: 'sub-1',
      generate,
    })
    await Promise.all([
      expect(pending).rejects.toThrow(
        'Failed after 3 attempts GatewayResponseError error sending request',
      ),
      (async () => {
        await vi.advanceTimersByTimeAsync(2_000)
        await vi.advanceTimersByTimeAsync(6_000)
      })(),
    ])
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('stops waiting when aborted during backoff', async () => {
    const controller = new AbortController()
    const generate = vi.fn<(messages: ModelMessage[] | undefined) => Promise<string>>()
    generate.mockRejectedValueOnce(transientGateway())

    const pending = generateTextWithTransientRetry({
      signal: controller.signal,
      subagentId: 'sub-1',
      generate,
    })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await expect(pending).rejects.toThrow('Subagent aborted')
    expect(generate).toHaveBeenCalledTimes(1)
  })
})
