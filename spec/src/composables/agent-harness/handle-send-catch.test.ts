import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AgentHarnessSession } from '@/composables/agent-harness/types'
import type { AgentStop } from '@/types/chat/agent-stop'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'

const retryParentTransient = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<'succeeded' | 'failed' | 'aborted' | 'fallthrough'>>(),
)
const persistTurnEnded = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
)

vi.mock('@/composables/agent-harness/retry-parent-transient', () => ({
  default: (...args: unknown[]) => retryParentTransient(...args),
}))

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistTurnEnded: (...args: unknown[]) => persistTurnEnded(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn<(...args: unknown[]) => void>() },
}))

import handleSendCatch from '@/composables/agent-harness/handle-send-catch'

const turnItem = (
  turnId: string,
  stop?: AgentStop,
): ChatTimelineItem => ({
  type: 'agent-turn',
  turn: {
    id: turnId,
    steps: [],
    text: '',
    ...(stop ? { stop } : {}),
  },
})

const buildInput = (
  timeline: ChatTimelineItem[],
  turnIdRemap?: Map<string, string>,
) => {
  const setAgentTurnError = vi.fn<(error: unknown) => void>()
  const setAgentTurnStop = vi.fn<(turnId: string, stop: unknown) => void>()
  const finishAgentTurn = vi.fn<() => void>()
  const session = {
    timeline: ref(timeline),
    turnIdRemap,
    setAgentTurnError,
    setAgentTurnStop,
    finishAgentTurn,
  } as unknown as AgentHarnessSession
  return {
    session,
    setAgentTurnError,
    setAgentTurnStop,
    finishAgentTurn,
    input: {
      err: new Error('provider exploded'),
      aborted: false,
      turnStarted: true,
      turnId: 'turn-1',
      appendedUserMessageId: 'user-1',
      args: {
        text: 'hello',
        mode: 'agent' as const,
        model: 'openai::gpt-4o',
        autoRetryAttempt: 0,
      },
      status: ref('submitted' as const),
      error: ref<string | null>(null),
      abortController: ref<AbortController | null>(null),
      session,
      suppressQueueDrainAfterStop: ref(false),
      resumeInFlight: ref(false),
      projectSlug: 'proj',
      chatId: 'chat-1',
      refreshSlug: vi.fn<(slug: string) => Promise<void>>(async () => undefined),
      applyTurnEndAttention: vi.fn<(outcome: 'success' | 'error') => void>(),
      maybeDrainQueue: vi.fn<() => Promise<void>>(async () => undefined),
      send: vi.fn<(...args: unknown[]) => Promise<'completed'>>(async () => 'completed'),
    },
  }
}

describe('handleSendCatch terminal stop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    retryParentTransient.mockResolvedValue('fallthrough')
    persistTurnEnded.mockResolvedValue(undefined)
  })

  it('writes a timeout stop after retry falls through', async () => {
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    const { input, setAgentTurnError, setAgentTurnStop } = buildInput([])
    input.err = timeout

    await expect(handleSendCatch(input)).resolves.toBe('failed')

    const stop = {
      reason: 'timeout',
      detail: 'The model took too long to respond.',
    }
    expect(setAgentTurnError).toHaveBeenCalledWith({
      kind: 'timeout',
      message: stop.detail,
    })
    expect(setAgentTurnStop).toHaveBeenCalledWith('turn-1', stop)
    expect(persistTurnEnded).toHaveBeenCalledWith('proj', 'chat-1', 'turn-1', stop)
  })

  it('writes an error stop with the same message as the turn error', async () => {
    const { input, setAgentTurnError, setAgentTurnStop } = buildInput([])

    await expect(handleSendCatch(input)).resolves.toBe('failed')

    const stop = { reason: 'error', detail: 'provider exploded' }
    expect(setAgentTurnError).toHaveBeenCalledWith({
      kind: 'error',
      message: 'provider exploded',
    })
    expect(setAgentTurnStop).toHaveBeenCalledWith('turn-1', stop)
    expect(persistTurnEnded).toHaveBeenCalledWith('proj', 'chat-1', 'turn-1', stop)
  })

  it('skips the stop write when the turn already has one', async () => {
    const { input, setAgentTurnError, setAgentTurnStop, finishAgentTurn } = buildInput([
      turnItem('turn-1', { reason: 'output-limit', finish: 'length', detail: 'cut' }),
    ])

    await expect(handleSendCatch(input)).resolves.toBe('failed')

    expect(setAgentTurnError).toHaveBeenCalled()
    expect(setAgentTurnStop).not.toHaveBeenCalled()
    expect(persistTurnEnded).not.toHaveBeenCalled()
    expect(finishAgentTurn).toHaveBeenCalled()
  })

  it('does not write a stop when a transient retry succeeds', async () => {
    retryParentTransient.mockResolvedValue('succeeded')
    const { input, setAgentTurnError, setAgentTurnStop, finishAgentTurn } = buildInput([])

    await expect(handleSendCatch(input)).resolves.toBe('completed')

    expect(setAgentTurnError).not.toHaveBeenCalled()
    expect(setAgentTurnStop).not.toHaveBeenCalled()
    expect(persistTurnEnded).not.toHaveBeenCalled()
    expect(finishAgentTurn).not.toHaveBeenCalled()
  })

  it('does not write a stop when retry reports aborted or failed', async () => {
    const { input, setAgentTurnStop } = buildInput([])

    retryParentTransient.mockResolvedValueOnce('aborted')
    await expect(handleSendCatch(input)).resolves.toBe('failed')

    retryParentTransient.mockResolvedValueOnce('failed')
    await expect(handleSendCatch(input)).resolves.toBe('failed')

    expect(setAgentTurnStop).not.toHaveBeenCalled()
    expect(persistTurnEnded).not.toHaveBeenCalled()
  })

  it('writes an error stop when compaction closed the original id', async () => {
    const { input, setAgentTurnStop } = buildInput(
      [
        turnItem('turn-1', { reason: 'compaction' }),
        turnItem('turn-2'),
      ],
      new Map([['turn-1', 'turn-2']]),
    )

    await expect(handleSendCatch(input)).resolves.toBe('failed')

    const stop = { reason: 'error', detail: 'provider exploded' }
    expect(setAgentTurnStop).toHaveBeenCalledWith('turn-1', stop)
    expect(persistTurnEnded).toHaveBeenCalledWith('proj', 'chat-1', 'turn-1', stop)
  })

  it('skips the stop write when the continuation turn already has one', async () => {
    const { input, setAgentTurnStop } = buildInput(
      [
        turnItem('turn-1', { reason: 'compaction' }),
        turnItem('turn-2', { reason: 'output-limit', finish: 'length' }),
      ],
      new Map([['turn-1', 'turn-2']]),
    )

    await expect(handleSendCatch(input)).resolves.toBe('failed')

    expect(setAgentTurnStop).not.toHaveBeenCalled()
    expect(persistTurnEnded).not.toHaveBeenCalled()
  })
})
