import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { SessionMutations } from '@/composables/chat-store/types'
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

const agentTurnsOf = (session: SessionMutations): AgentTurn[] =>
  session.timeline.value.flatMap((item) =>
    item.type === 'agent-turn' ? [item.turn] : [],
  )

const turnOf = (session: SessionMutations, turnId: string): AgentTurn | null =>
  agentTurnsOf(session).find((turn) => turn.id === turnId) ?? null

const seedErroredTurn = (
  session: SessionMutations,
  turnId = 'turn-1',
  kind: 'error' | 'timeout' | 'aborted' = 'error',
): void => {
  session.startAgentTurn(turnId)
  session.startAgentStep('step-1')
  session.appendLocalTextDelta('partial answer', turnId, 'step-1')
  session.flushPendingStreamDeltas()
  session.setAgentTurnError({ kind, message: 'provider failed' })
  session.finishAgentTurn()
}

describe('resumeAgentTurn', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('sets activeTurnId, clears error, and does not add a timeline item', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-resume')
    seedErroredTurn(session)

    expect(session.activeTurnId.value).toBeNull()
    expect(turnOf(session, 'turn-1')?.error).toEqual({
      kind: 'error',
      message: 'provider failed',
    })
    const timelineLength = session.timeline.value.length

    session.resumeAgentTurn('turn-1')

    expect(session.activeTurnId.value).toBe('turn-1')
    expect(turnOf(session, 'turn-1')?.error).toBeUndefined()
    expect(session.timeline.value).toHaveLength(timelineLength)
    expect(agentTurnsOf(session)).toHaveLength(1)
  })

  it('appends later steps and tool runs into the reopened turn', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-resume-append')
    seedErroredTurn(session)
    session.resumeAgentTurn('turn-1')

    session.startAgentStep('step-2')
    session.upsertLocalToolRun({
      toolCallId: 'tc-2',
      name: 'read_file',
      status: 'running',
      args: { path: 'a.ts' },
    })

    expect(agentTurnsOf(session)).toHaveLength(1)
    const turn = turnOf(session, 'turn-1')
    expect(turn?.id).toBe('turn-1')
    expect(turn?.steps.map((step) => step.id)).toEqual(['step-1', 'step-2'])
    expect(turn?.steps[0]?.text).toBe('partial answer')
    expect(turn?.steps[1]?.tools).toEqual([
      {
        toolCallId: 'tc-2',
        name: 'read_file',
        status: 'running',
        args: { path: 'a.ts' },
      },
    ])
  })

  it('does nothing when no agent-turn with that id exists', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-resume-missing')
    seedErroredTurn(session)
    const snapshot = session.timeline.value

    session.resumeAgentTurn('missing-turn')

    expect(session.activeTurnId.value).toBeNull()
    expect(session.timeline.value).toBe(snapshot)
    expect(turnOf(session, 'turn-1')?.error).toEqual({
      kind: 'error',
      message: 'provider failed',
    })
  })
})

describe('getContinuableTurn', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('returns the last errored agent turn', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-continue')
    seedErroredTurn(session)

    const continuable = session.getContinuableTurn()
    expect(continuable?.id).toBe('turn-1')
    expect(continuable?.error?.kind).toBe('error')
    expect(continuable?.steps[0]?.text).toBe('partial answer')
  })

  it('returns null when the error is aborted', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-continue-aborted')
    seedErroredTurn(session, 'turn-1', 'aborted')

    expect(session.getContinuableTurn()).toBeNull()
  })

  it('returns null when a user item follows', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-continue-user')
    seedErroredTurn(session)
    session.appendLocalMessage({
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'try again' }],
    })

    expect(session.getContinuableTurn()).toBeNull()
  })

  it('returns null when the turn has no content', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-continue-empty')
    session.startAgentTurn('turn-1')
    session.setAgentTurnError({ kind: 'error', message: 'provider failed' })
    session.finishAgentTurn()

    expect(session.getContinuableTurn()).toBeNull()
  })

  it('still returns when a todo item follows', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-continue-todo')
    seedErroredTurn(session)
    session.appendLocalTodoUpdate([
      { id: 'todo-1', content: 'keep going', status: 'in_progress' },
    ])

    const continuable = session.getContinuableTurn()
    expect(continuable?.id).toBe('turn-1')
    expect(session.timeline.value.at(-1)?.type).toBe('todo')
  })

  it('returns null when a compaction item follows', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-continue-compact')
    seedErroredTurn(session)
    session.appendLocalCompaction('summarized so far', null)

    expect(session.getContinuableTurn()).toBeNull()
  })
})
