import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AgentHarnessSession } from '@/composables/agent-harness/types'
import type { AgentStop } from '@/types/chat/agent-stop'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'

const waitAbortAware = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
)
const persistTurnEnded = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
)

vi.mock('@/services/harness/transient-error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/harness/transient-error')>()
  return {
    ...actual,
    waitAbortAware: (...args: unknown[]) => waitAbortAware(...args),
  }
})

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistTurnEnded: (...args: unknown[]) => persistTurnEnded(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => void>(),
  },
}))

import retryParentTransient from '@/composables/agent-harness/retry-parent-transient'

const turn = (stop?: AgentStop): ChatTimelineItem => ({
  type: 'agent-turn',
  turn: {
    id: 'turn-1',
    steps: [],
    text: '',
    ...(stop ? { stop } : {}),
  },
})

const buildArgs = (
  timeline: ChatTimelineItem[],
  turnIdRemap?: Map<string, string>,
) => {
  const setAgentTurnStop = vi.fn<(turnId: string, stop: unknown) => void>()
  const finishAgentTurn = vi.fn<() => void>()
  const session = {
    timeline: ref(timeline),
    turnIdRemap,
    setAgentTurnStop,
  } as unknown as AgentHarnessSession
  return {
    setAgentTurnStop,
    finishAgentTurn,
    args: {
      err: new Error('fetch failed'),
      turnStarted: true,
      turnId: 'turn-1',
      appendedUserMessageId: 'user-1',
      autoRetryAttempt: 0,
      mode: 'agent' as const,
      model: 'openai::gpt-4o',
      originalInternal: false,
      status: ref('submitted' as const),
      error: ref<string | null>(null),
      abortController: ref<AbortController | null>(null),
      finishAgentTurn,
      suppressQueueDrainAfterStop: ref(false),
      session,
      projectSlug: 'proj',
      chatId: 'chat-1',
      refreshSlug: vi.fn<(slug: string) => Promise<void>>(async () => undefined),
      maybeDrainQueue: vi.fn<() => Promise<void>>(async () => undefined),
      send: vi.fn<(...args: unknown[]) => Promise<'completed'>>(async () => 'completed'),
    },
  }
}

describe('retryParentTransient waitAborted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persistTurnEnded.mockResolvedValue(undefined)
    waitAbortAware.mockRejectedValue(new Error('Chat aborted'))
  })

  it('writes user-stop when the user stops during retry backoff', async () => {
    const { args, setAgentTurnStop, finishAgentTurn } = buildArgs([turn()])

    await expect(retryParentTransient(args)).resolves.toBe('aborted')

    expect(setAgentTurnStop).toHaveBeenCalledWith('turn-1', { reason: 'user-stop' })
    expect(persistTurnEnded).toHaveBeenCalledWith('proj', 'chat-1', 'turn-1', {
      reason: 'user-stop',
    })
    expect(finishAgentTurn).toHaveBeenCalled()
    expect(args.send).not.toHaveBeenCalled()
  })

  it('skips user-stop when the turn already has a stop', async () => {
    const { args, setAgentTurnStop, finishAgentTurn } = buildArgs([
      turn({ reason: 'output-limit' }),
    ])

    await expect(retryParentTransient(args)).resolves.toBe('aborted')

    expect(setAgentTurnStop).not.toHaveBeenCalled()
    expect(persistTurnEnded).not.toHaveBeenCalled()
    expect(finishAgentTurn).toHaveBeenCalled()
  })

  it('writes user-stop when compaction closed the original id', async () => {
    const { args, setAgentTurnStop, finishAgentTurn } = buildArgs(
      [
        turn({ reason: 'compaction' }),
        {
          type: 'agent-turn',
          turn: { id: 'turn-2', steps: [], text: '' },
        },
      ],
      new Map([['turn-1', 'turn-2']]),
    )

    await expect(retryParentTransient(args)).resolves.toBe('aborted')

    expect(setAgentTurnStop).toHaveBeenCalledWith('turn-1', { reason: 'user-stop' })
    expect(persistTurnEnded).toHaveBeenCalledWith('proj', 'chat-1', 'turn-1', {
      reason: 'user-stop',
    })
    expect(finishAgentTurn).toHaveBeenCalled()
  })

  it('skips user-stop when the continuation turn already has a stop', async () => {
    const { args, setAgentTurnStop } = buildArgs(
      [
        turn({ reason: 'compaction' }),
        {
          type: 'agent-turn',
          turn: {
            id: 'turn-2',
            steps: [],
            text: '',
            stop: { reason: 'timeout', detail: 'stalled' },
          },
        },
      ],
      new Map([['turn-1', 'turn-2']]),
    )

    await expect(retryParentTransient(args)).resolves.toBe('aborted')

    expect(setAgentTurnStop).not.toHaveBeenCalled()
    expect(persistTurnEnded).not.toHaveBeenCalled()
  })
})
