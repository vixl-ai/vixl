import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTurn } from '@/types/chat/agent-turn'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const persistTurnEnded = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
)

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

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistTurnEnded: (
    projectSlug: string,
    chatId: string,
    turnId: string,
    stop: unknown,
  ) => persistTurnEnded(projectSlug, chatId, turnId, stop),
}))

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

const toolsOf = (turn: AgentTurn) => turn.steps.flatMap((step) => step.tools)

const stepTextOf = (turn: AgentTurn) => turn.steps.map((step) => step.text).join('')

describe('compaction splits the agent turn', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('routes post-compaction events into a new turn below the marker', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-compact-split')

    session.startAgentTurn('t1')
    session.appendLocalTextDelta('before', 't1', 'step1')
    session.upsertLocalToolRun({
      toolCallId: 'tc1',
      name: 'read_file',
      status: 'done',
    })

    const preItem = session.timeline.value.find(
      (item) => item.type === 'agent-turn' && item.turn.id === 't1',
    )
    expect(preItem?.type).toBe('agent-turn')
    if (preItem?.type !== 'agent-turn') {
      return
    }
    const preSnapshot = JSON.parse(JSON.stringify(preItem.turn)) as AgentTurn

    session.appendLocalCompaction('summary', 'parent')
    session.appendLocalTextDelta('after', 't1', 'step2')
    session.upsertLocalToolRun({
      toolCallId: 'tc2',
      name: 'edit_file',
      status: 'done',
    })

    const timeline = session.timeline.value
    expect(timeline.map((item) => item.type)).toEqual([
      'agent-turn',
      'compaction',
      'agent-turn',
    ])

    const first = timeline[0]
    expect(first?.type).toBe('agent-turn')
    if (first?.type !== 'agent-turn') {
      return
    }
    expect(first.turn.id).toBe('t1')

    const marker = timeline[1]
    expect(marker).toEqual({
      type: 'compaction',
      summary: 'summary',
      focus: 'parent',
    })

    const second = timeline[2]
    expect(second?.type).toBe('agent-turn')
    if (second?.type !== 'agent-turn') {
      return
    }
    expect(second.turn.id).not.toBe('t1')

    expect(first.turn.text).toBe(preSnapshot.text)
    expect(stepTextOf(first.turn)).toBe(stepTextOf(preSnapshot))
    expect(toolsOf(first.turn)).toEqual(toolsOf(preSnapshot))
    expect(stepTextOf(first.turn)).toContain('before')
    expect(stepTextOf(first.turn)).not.toContain('after')
    expect(toolsOf(first.turn).some((tool) => tool.toolCallId === 'tc2')).toBe(
      false,
    )

    expect(first.turn.stop).toEqual({ reason: 'compaction' })
    expect(stepTextOf(second.turn)).toContain('after')
    expect(
      toolsOf(second.turn).some(
        (tool) => tool.toolCallId === 'tc2' && tool.name === 'edit_file',
      ),
    ).toBe(true)
  })

  it('does not append an empty trailing turn when compaction has no follow-up events', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-compact-no-follow')

    session.startAgentTurn('t1')
    session.appendLocalTextDelta('before', 't1', 'step1')
    session.upsertLocalToolRun({
      toolCallId: 'tc1',
      name: 'read_file',
      status: 'done',
    })
    await session.appendLocalCompaction('summary', 'parent')

    const timeline = session.timeline.value
    expect(timeline).toHaveLength(2)
    expect(persistTurnEnded).toHaveBeenCalledWith('proj', 'chat-compact-no-follow', 't1', {
      reason: 'compaction',
    })
    expect(timeline[0]?.type).toBe('agent-turn')
    if (timeline[0]?.type !== 'agent-turn') {
      return
    }
    expect(timeline[0].turn.stop).toEqual({ reason: 'compaction' })
    expect(timeline[0].turn.id).toBe('t1')
    expect(timeline[1]).toEqual({
      type: 'compaction',
      summary: 'summary',
      focus: 'parent',
    })
  })

  it('does not overwrite a stop already on the closed turn', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-compact-guard')
    session.startAgentTurn('t1')
    session.setAgentTurnStop('t1', { reason: 'output-limit', finish: 'length' })
    persistTurnEnded.mockClear()

    await session.appendLocalCompaction('summary', null)

    const first = session.timeline.value[0]
    expect(first?.type).toBe('agent-turn')
    if (first?.type !== 'agent-turn') {
      return
    }
    expect(first.turn.stop).toEqual({ reason: 'output-limit', finish: 'length' })
    expect(persistTurnEnded).not.toHaveBeenCalled()
  })

  it('does not write a compaction stop when no turn is active', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-compact-idle')
    persistTurnEnded.mockClear()

    await session.appendLocalCompaction('summary', null)

    expect(session.timeline.value).toEqual([
      { type: 'compaction', summary: 'summary', focus: null },
    ])
    expect(persistTurnEnded).not.toHaveBeenCalled()
  })

  it('keeps compaction on the closed turn and completed on the continuation', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-compact-complete')
    session.startAgentTurn('t1')
    session.appendLocalTextDelta('before', 't1', 'step1')
    session.upsertLocalToolRun({
      toolCallId: 'tc1',
      name: 'read_file',
      status: 'done',
    })
    await session.appendLocalCompaction('summary', 'parent')
    session.appendLocalTextDelta('after', 't1', 'step2')
    session.upsertLocalToolRun({
      toolCallId: 'tc2',
      name: 'edit_file',
      status: 'done',
    })

    session.setAgentTurnStop('t1', { reason: 'completed', finish: 'stop' })
    session.setAgentTurnStop('t1', { reason: 'error', detail: 'late' })

    const turns = session.timeline.value.flatMap((item) =>
      item.type === 'agent-turn' ? [item.turn] : [],
    )
    expect(turns).toHaveLength(2)
    expect(turns[0]?.id).toBe('t1')
    expect(turns[0]?.stop).toEqual({ reason: 'compaction' })
    expect(turns[1]?.id).not.toBe('t1')
    expect(turns[1]?.id).toBe(session.turnIdRemap.get('t1'))
    expect(turns[1]?.stop).toEqual({ reason: 'completed', finish: 'stop' })
    expect(turns[1] ? stepTextOf(turns[1]).includes('after') : false).toBe(true)
  })

  it('lands a user stop after compaction on the continuation turn', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-compact-user-stop')
    session.startAgentTurn('t1')
    session.appendLocalTextDelta('before', 't1', 'step1')
    await session.appendLocalCompaction('summary', null)
    session.appendLocalTextDelta('after', 't1', 'step2')
    session.flushPendingStreamDeltas()

    session.setAgentTurnStop('t1', { reason: 'user-stop' })

    const turns = session.timeline.value.flatMap((item) =>
      item.type === 'agent-turn' ? [item.turn] : [],
    )
    expect(turns[0]?.stop).toEqual({ reason: 'compaction' })
    expect(turns[1]?.stop).toEqual({ reason: 'user-stop' })
    expect(turns[1]?.id).toBe(session.turnIdRemap.get('t1'))
  })

  it('writes a post-compaction failure onto the continuation turn', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { writeGuardedTurnStop } = await import(
      '@/composables/agent-harness/turn-stop'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-compact-fail')
    session.startAgentTurn('t1')
    session.appendLocalTextDelta('before', 't1', 'step1')
    await session.appendLocalCompaction('summary', null)
    session.appendLocalTextDelta('after', 't1', 'step2')
    session.flushPendingStreamDeltas()
    persistTurnEnded.mockClear()

    const stop = { reason: 'error' as const, detail: 'provider exploded' }
    await writeGuardedTurnStop({
      timeline: session.timeline.value,
      turnId: 't1',
      turnIdRemap: session.turnIdRemap,
      stop,
      projectSlug: 'proj',
      chatId: 'chat-compact-fail',
      setAgentTurnStop: (turnId, next) => {
        session.setAgentTurnStop(turnId, next)
      },
    })
    await writeGuardedTurnStop({
      timeline: session.timeline.value,
      turnId: 't1',
      turnIdRemap: session.turnIdRemap,
      stop: { reason: 'timeout', detail: 'late' },
      projectSlug: 'proj',
      chatId: 'chat-compact-fail',
      setAgentTurnStop: (turnId, next) => {
        session.setAgentTurnStop(turnId, next)
      },
    })

    const turns = session.timeline.value.flatMap((item) =>
      item.type === 'agent-turn' ? [item.turn] : [],
    )
    expect(turns[0]?.stop).toEqual({ reason: 'compaction' })
    expect(turns[1]?.stop).toEqual(stop)
    expect(persistTurnEnded).toHaveBeenCalledTimes(1)
    expect(persistTurnEnded).toHaveBeenCalledWith(
      'proj',
      'chat-compact-fail',
      't1',
      stop,
    )
  })
})
