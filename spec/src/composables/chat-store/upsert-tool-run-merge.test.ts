import { beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('upsertLocalToolRun merge across turns', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('merges a later-turn tool result into the prior turn that owns the toolCallId', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'chat-a')

    session.startAgentTurn('turn-1')
    session.upsertLocalToolRun({
      toolCallId: 'tc-1',
      name: 'spawn_subagent',
      status: 'running',
      args: {
        agentName: 'Sub one',
        prompt: 'do the work',
        mode: 'background',
      },
    })
    session.finishAgentTurn()

    session.startAgentTurn('turn-2')
    session.upsertLocalToolRun({
      toolCallId: 'tc-1',
      name: 'spawn_subagent',
      status: 'done',
      result: { subagentId: 'sub-1', label: 'Sub one', status: 'done' },
    })

    const agentTurns = session.timeline.value.filter(
      (item) => item.type === 'agent-turn',
    )
    expect(agentTurns).toHaveLength(2)

    const turn1 = agentTurns[0]
    expect(turn1?.type).toBe('agent-turn')
    if (turn1?.type !== 'agent-turn') {
      return
    }
    expect(turn1.turn.id).toBe('turn-1')
    const turn1Tool = turn1.turn.steps
      .flatMap((step) => step.tools)
      .find((tool) => tool.toolCallId === 'tc-1')
    expect(turn1Tool).toMatchObject({
      toolCallId: 'tc-1',
      name: 'spawn_subagent',
      status: 'done',
      result: { subagentId: 'sub-1', label: 'Sub one', status: 'done' },
    })

    const turn2 = agentTurns[1]
    expect(turn2?.type).toBe('agent-turn')
    if (turn2?.type !== 'agent-turn') {
      return
    }
    expect(turn2.turn.id).toBe('turn-2')
    const turn2Tools = turn2.turn.steps.flatMap((step) => step.tools)
    expect(turn2Tools.some((tool) => tool.toolCallId === 'tc-1')).toBe(false)
    expect(turn2Tools.some((tool) => tool.name === 'spawn_subagent')).toBe(false)
  })
})
