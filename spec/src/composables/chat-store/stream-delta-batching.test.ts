import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import type { AgentTurn } from '@/types/chat/agent-turn'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const { metaFor } = vi.hoisted(() => {
  const metaFor = (id: string) => ({
    id,
    title: id,
    projectSlug: 'proj',
    projectRoot: '/proj',
    mode: 'agent',
    model: 'test/model',
    status: 'idle' as const,
    attention: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    forkedFrom: null,
    pinned: false,
    pinnedAt: null,
  })
  return { metaFor }
})

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    createChat: vi.fn<() => Promise<unknown>>(),
    listChats: vi.fn<() => Promise<unknown>>(),
    readChatMeta: vi.fn<
      (_slug: string, chatId: string) => Promise<ReturnType<typeof metaFor>>
    >(async (_slug, chatId) => metaFor(chatId)),
    readChatMessages: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    updateChatMeta: vi.fn<
      (
        _slug: string,
        chatId: string,
        patch: Record<string, unknown>,
      ) => Promise<ReturnType<typeof metaFor> & Record<string, unknown>>
    >(async (_slug, chatId, patch) => ({
      ...metaFor(chatId),
      ...patch,
    })),
  }),
)

const turnOf = (timeline: { value: unknown[] }, turnId: string): AgentTurn | null => {
  const item = (timeline.value as Array<{ type: string; turn?: AgentTurn }>).find(
    (entry) => entry.type === 'agent-turn' && entry.turn?.id === turnId,
  )
  return item?.turn ?? null
}

const stepTextOf = (turn: AgentTurn | null): string =>
  turn?.steps.map((step) => step.text).join('') ?? ''

const stepReasoningOf = (turn: AgentTurn | null): string =>
  turn?.steps.map((step) => step.reasoning).join('') ?? ''

describe('stream delta batching', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('coalesces multiple text deltas into one timeline update', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { STREAM_DELTA_FLUSH_MS } = await import(
      '@/composables/chat-store/stream-delta-buffer'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-batch')
    session.startAgentTurn('turn-1')
    session.startAgentStep('step-1')

    let timelineUpdates = 0
    const stop = watch(
      session.timeline,
      () => {
        timelineUpdates += 1
      },
      { flush: 'sync' },
    )

    session.appendLocalTextDelta('Hello ', 'turn-1', 'step-1')
    session.appendLocalTextDelta('world', 'turn-1', 'step-1')
    expect(stepTextOf(turnOf(session.timeline, 'turn-1'))).toBe('')
    expect(timelineUpdates).toBe(0)

    await vi.advanceTimersByTimeAsync(STREAM_DELTA_FLUSH_MS)
    expect(stepTextOf(turnOf(session.timeline, 'turn-1'))).toBe('Hello world')
    expect(timelineUpdates).toBe(1)
    stop()
  })

  it('flushes pending text before a tool upsert on the same turn', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-order')
    session.startAgentTurn('turn-1')
    session.startAgentStep('step-1')

    session.appendLocalTextDelta('before tool', 'turn-1', 'step-1')
    expect(stepTextOf(turnOf(session.timeline, 'turn-1'))).toBe('')

    session.upsertLocalToolRun({
      toolCallId: 'tc-1',
      name: 'read_file',
      status: 'running',
    })

    const turn = turnOf(session.timeline, 'turn-1')
    expect(stepTextOf(turn)).toBe('before tool')
    expect(turn?.steps[0]?.tools[0]?.toolCallId).toBe('tc-1')
  })

  it('flushes pending reasoning before step finish', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-step-finish')
    session.startAgentTurn('turn-1')
    session.startAgentStep('step-1')

    session.appendLocalReasoningDelta('think ', 'turn-1', 'step-1')
    session.appendLocalReasoningDelta('more', 'turn-1', 'step-1')
    expect(stepReasoningOf(turnOf(session.timeline, 'turn-1'))).toBe('')

    session.finishAgentStep()
    expect(stepReasoningOf(turnOf(session.timeline, 'turn-1'))).toBe('think more')
  })

  it('keeps already-emitted text when the turn is aborted', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-abort')
    session.startAgentTurn('turn-1')
    session.startAgentStep('step-1')

    session.appendLocalTextDelta('partial answer', 'turn-1', 'step-1')
    expect(stepTextOf(turnOf(session.timeline, 'turn-1'))).toBe('')

    session.finishAgentTurn()
    expect(stepTextOf(turnOf(session.timeline, 'turn-1'))).toBe('partial answer')
    expect(session.activeTurnId.value).toBeNull()
  })

  it('keeps per-session buffers isolated across concurrent chats', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { STREAM_DELTA_FLUSH_MS } = await import(
      '@/composables/chat-store/stream-delta-buffer'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const sessionA = store.forChat('proj', 'chat-a')
    const sessionB = store.forChat('proj', 'chat-b')

    sessionA.startAgentTurn('turn-a')
    sessionA.startAgentStep('step-a')
    sessionB.startAgentTurn('turn-b')
    sessionB.startAgentStep('step-b')

    sessionA.appendLocalTextDelta('alpha', 'turn-a', 'step-a')
    sessionB.appendLocalTextDelta('bravo', 'turn-b', 'step-b')

    sessionA.upsertLocalToolRun({
      toolCallId: 'tc-a',
      name: 'read_file',
      status: 'running',
    })

    expect(stepTextOf(turnOf(sessionA.timeline, 'turn-a'))).toBe('alpha')
    expect(stepTextOf(turnOf(sessionB.timeline, 'turn-b'))).toBe('')
    expect(stepTextOf(turnOf(sessionA.timeline, 'turn-b'))).toBe('')
    expect(stepTextOf(turnOf(sessionB.timeline, 'turn-a'))).toBe('')

    await vi.advanceTimersByTimeAsync(STREAM_DELTA_FLUSH_MS)
    expect(stepTextOf(turnOf(sessionB.timeline, 'turn-b'))).toBe('bravo')
    expect(stepTextOf(turnOf(sessionA.timeline, 'turn-a'))).toBe('alpha')
  })

  it('discards pending deltas and timers when a session is dropped', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { STREAM_DELTA_FLUSH_MS } = await import(
      '@/composables/chat-store/stream-delta-buffer'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-drop')
    session.startAgentTurn('turn-1')
    session.startAgentStep('step-1')
    session.appendLocalTextDelta('should not apply', 'turn-1', 'step-1')

    store.dropSession('proj', 'chat-drop')
    await vi.advanceTimersByTimeAsync(STREAM_DELTA_FLUSH_MS)

    expect(stepTextOf(turnOf(session.timeline, 'turn-1'))).toBe('')
    const revived = store.forChat('proj', 'chat-drop')
    expect(revived.timeline.value).toEqual([])
  })

  it('stores reasoningSeconds on the active step', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-duration')
    session.startAgentTurn('turn-1')
    session.startAgentStep('step-1')
    session.setLocalReasoningSeconds('step-1', 4)

    expect(turnOf(session.timeline, 'turn-1')?.steps[0]?.reasoningSeconds).toBe(4)
  })
})
