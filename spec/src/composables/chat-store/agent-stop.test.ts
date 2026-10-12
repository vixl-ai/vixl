import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
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

const turnOf = (session: SessionMutations, turnId: string): AgentTurn | null => {
  for (let index = session.timeline.value.length - 1; index >= 0; index -= 1) {
    const item = session.timeline.value[index]
    if (item?.type === 'agent-turn' && item.turn.id === turnId) {
      return item.turn
    }
  }
  return null
}

const subagentOf = (
  session: SessionMutations,
  subagentId: string,
): SubagentTimelineItem | null => {
  const item = session.timeline.value.find(
    (entry) => entry.type === 'subagent' && entry.subagentId === subagentId,
  )
  return item?.type === 'subagent' ? item : null
}

describe('setAgentTurnStop', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('patches the active turn when the id matches', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-stop-active')
    session.startAgentTurn('turn-1')
    session.startAgentStep('step-1')
    session.appendLocalTextDelta('partial', 'turn-1', 'step-1')
    session.flushPendingStreamDeltas()

    session.setAgentTurnStop('turn-1', { reason: 'completed', finish: 'stop' })

    expect(session.activeTurnId.value).toBe('turn-1')
    expect(turnOf(session, 'turn-1')?.stop).toEqual({
      reason: 'completed',
      finish: 'stop',
    })
  })

  it('patches a timeline turn by id when a later turn is active', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-stop-timeline')
    session.startAgentTurn('turn-1')
    session.startAgentStep('step-1')
    session.appendLocalTextDelta('first', 'turn-1', 'step-1')
    session.flushPendingStreamDeltas()
    session.finishAgentTurn()
    session.appendLocalTodoUpdate([
      { id: 'todo-1', content: 'keep going', status: 'in_progress' },
    ])
    session.startAgentTurn('turn-2')

    session.setAgentTurnStop('turn-1', { reason: 'timeout', detail: 'stalled' })

    expect(turnOf(session, 'turn-1')?.stop).toEqual({
      reason: 'timeout',
      detail: 'stalled',
    })
    expect(turnOf(session, 'turn-2')?.stop).toBeUndefined()
    expect(session.timeline.value.at(-1)?.type).toBe('agent-turn')
  })

  it('leaves the timeline alone when the turn id is missing', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-stop-missing')
    session.startAgentTurn('turn-1')
    const snapshot = session.timeline.value

    session.setAgentTurnStop('missing', { reason: 'error' })

    expect(session.timeline.value).toBe(snapshot)
    expect(turnOf(session, 'turn-1')?.stop).toBeUndefined()
  })

  it('does not overwrite a stop already on the turn', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-stop-keep')
    session.startAgentTurn('turn-1')
    session.setAgentTurnStop('turn-1', { reason: 'completed', finish: 'stop' })

    session.setAgentTurnStop('turn-1', { reason: 'error', detail: 'late' })

    expect(turnOf(session, 'turn-1')?.stop).toEqual({
      reason: 'completed',
      finish: 'stop',
    })
  })
})

describe('completeLocalSubagent stop', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('does not regress an existing stop on a duplicate result', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-sub-stop')
    session.upsertLocalSubagentStart({
      subagentId: 'sub-1',
      name: 'explore',
      blocking: false,
    })
    session.completeLocalSubagent('sub-1', 'found it', 'done', {
      reason: 'completed',
      finish: 'stop',
    })
    session.completeLocalSubagent('sub-1', 'Stopped', 'stopped')
    session.completeLocalSubagent('sub-1', 'failed later', 'error', {
      reason: 'error',
      detail: 'boom',
    })

    const item = subagentOf(session, 'sub-1')
    expect(item?.status).toBe('error')
    expect(item?.summary).toBe('failed later')
    expect(item?.stop).toEqual({ reason: 'completed', finish: 'stop' })
  })
})
