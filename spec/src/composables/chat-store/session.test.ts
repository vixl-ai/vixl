import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
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
    truncateChatLog: vi.fn<() => Promise<void>>(async () => {}),
  }),
)

describe('chat session registry isolation', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('keeps session A timeline when active session is B', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()

    const sessionA = store.forChat('proj', 'chat-a')
    sessionA.startAgentTurn('turn-a')
    sessionA.appendLocalTextDelta('hello from A', 'turn-a')
    sessionA.flushPendingStreamDeltas()

    await store.loadChat('proj', 'chat-b')
    const sessionB = store.forChat('proj', 'chat-b')
    sessionB.startAgentTurn('turn-b')
    sessionB.appendLocalTextDelta('hello from B', 'turn-b')
    sessionB.flushPendingStreamDeltas()

    expect(
      store.timeline.value.some(
        (item) => item.type === 'agent-turn' && item.turn.id === 'turn-b',
      ),
    ).toBe(true)
    expect(
      store.timeline.value.some(
        (item) => item.type === 'agent-turn' && item.turn.id === 'turn-a',
      ),
    ).toBe(false)

    const stillA = store.forChat('proj', 'chat-a')
    expect(
      stillA.timeline.value.some(
        (item) => item.type === 'agent-turn' && item.turn.id === 'turn-a',
      ),
    ).toBe(true)
    expect(
      stillA.timeline.value.some(
        (item) => item.type === 'agent-turn' && item.turn.id === 'turn-b',
      ),
    ).toBe(false)
  })

  it('clearChatState does not wipe other sessions', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const sessionA = store.forChat('proj', 'chat-a')
    sessionA.startAgentTurn('turn-a')
    sessionA.appendLocalTextDelta('keep me', 'turn-a')
    sessionA.flushPendingStreamDeltas()
    // Mark warm without wiping timeline: loadChat on empty disk after mutations
    // would hydrate empty. Use isSessionWarm via create path instead.
    await store.loadChat('proj', 'chat-a')
    // After cold hydrate the timeline is empty from disk; seed again on warm session
    const warmA = store.forChat('proj', 'chat-a')
    warmA.startAgentTurn('turn-a')
    warmA.appendLocalTextDelta('keep me', 'turn-a')
    warmA.flushPendingStreamDeltas()

    store.clearChatState()

    expect(store.meta.value).toBeNull()
    expect(store.isSessionWarm('proj', 'chat-a')).toBe(true)
    expect(
      store.forChat('proj', 'chat-a').timeline.value.some(
        (item) => item.type === 'agent-turn' && item.turn.id === 'turn-a',
      ),
    ).toBe(true)
  })

  it('selectChat flips focus sync and warm idle skips message hydrate', async () => {
    const vixl = await import('@/services/vixl/vixl-tauri')
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()

    await store.loadChat('proj', 'chat-a')
    const warm = store.forChat('proj', 'chat-a')
    warm.startAgentTurn('turn-a')
    warm.appendLocalTextDelta('cached', 'turn-a')
    warm.flushPendingStreamDeltas()
    warm.finishAgentTurn()
    expect(store.isSessionWarm('proj', 'chat-a')).toBe(true)

    vi.mocked(vixl.readChatMessages).mockClear()
    vi.mocked(vixl.readChatMeta).mockClear()

    store.selectChat('proj', 'chat-b')
    expect(store.activeKey.value).toBe('proj::chat-b')

    store.selectChat('proj', 'chat-a')
    const path = await store.ensureChatHydrated('proj', 'chat-a')
    expect(path).toBe('warmIdle')
    expect(vixl.readChatMessages).not.toHaveBeenCalled()
    expect(
      store.forChat('proj', 'chat-a').timeline.value.some(
        (item) => item.type === 'agent-turn' && item.turn.id === 'turn-a',
      ),
    ).toBe(true)
  })

  it('clears context usage when the active chat becomes null', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const contextUsage = useContextUsage()

    await store.loadChat('proj', 'chat-a')
    contextUsage.setBudget({
      modelId: 'test/model',
      limit: 262_000,
      promptUsed: 5_000,
      reservedOutput: 33_000,
      safetyBuffer: 2_000,
      free: 222_000,
      used: 5_000,
      buckets: [{ id: 'messages', label: 'Conversation', tokens: 5_000 }],
    })
    contextUsage.setLastStepUsage({
      promptTokens: 51_000,
      inputTokens: 51_000,
      outputTokens: 1_200,
      cacheReadTokens: 47_000,
      cacheWriteTokens: 0,
    })
    expect(contextUsage.promptUsed.value).toBe(51_000)

    store.clearChatState()

    expect(store.meta.value).toBeNull()
    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.promptUsed.value).toBe(0)
  })

  it('does not inherit context fill after delete then create with the same project and model', async () => {
    const vixl = await import('@/services/vixl/vixl-tauri')
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const contextUsage = useContextUsage()

    await store.loadChat('proj', 'chat-a')
    contextUsage.setBudget({
      modelId: 'test/model',
      limit: 262_000,
      promptUsed: 5_000,
      reservedOutput: 33_000,
      safetyBuffer: 2_000,
      free: 222_000,
      used: 5_000,
      buckets: [{ id: 'messages', label: 'Conversation', tokens: 5_000 }],
    })
    contextUsage.setLastStepUsage({
      promptTokens: 51_000,
      inputTokens: 51_000,
      outputTokens: 1_200,
      cacheReadTokens: 47_000,
      cacheWriteTokens: 0,
    })
    expect(contextUsage.promptUsed.value).toBe(51_000)

    store.dropSession('proj', 'chat-a')
    expect(store.meta.value).toBeNull()
    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.promptUsed.value).toBe(0)

    vi.mocked(vixl.createChat).mockResolvedValueOnce(metaFor('chat-new'))
    await store.createNewChat({
      projectSlug: 'proj',
      projectRoot: '/proj',
      mode: 'agent',
      model: 'test/model',
    })

    expect(store.meta.value?.id).toBe('chat-new')
    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.promptUsed.value).toBe(0)
  })

  it('does not reset bound usage while cold hydrate is loading without meta', async () => {
    const vixl = await import('@/services/vixl/vixl-tauri')
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    const { default: useChatContextBudgetSync } = await import(
      '@/composables/use-chat-context-budget-sync'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const contextUsage = useContextUsage()
    useChatContextBudgetSync()

    store.selectChat('proj', 'chat-a')
    contextUsage.setBudget({
      modelId: 'test/model',
      limit: 262_000,
      promptUsed: 5_000,
      reservedOutput: 33_000,
      safetyBuffer: 2_000,
      free: 222_000,
      used: 5_000,
      buckets: [{ id: 'messages', label: 'Conversation', tokens: 5_000 }],
    })
    contextUsage.setLastStepUsage({
      promptTokens: 51_000,
      inputTokens: 51_000,
      outputTokens: 1_200,
      cacheReadTokens: 47_000,
      cacheWriteTokens: 0,
    })
    expect(contextUsage.promptUsed.value).toBe(51_000)

    let releaseMeta: ((value: ReturnType<typeof metaFor>) => void) | undefined
    vi.mocked(vixl.readChatMeta).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseMeta = resolve
        }),
    )

    const hydrating = store.ensureChatHydrated('proj', 'chat-a')
    expect(store.loading.value).toBe(true)
    expect(store.meta.value).toBeNull()

    await nextTick()
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0)
    })

    expect(contextUsage.lastStepUsage.value?.inputTokens).toBe(51_000)
    expect(contextUsage.promptUsed.value).toBe(51_000)

    releaseMeta?.(metaFor('chat-a'))
    await hydrating
  })

  it('does not reset bound usage after selectChat before hydrate when loading is false', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    const { default: useChatContextBudgetSync } = await import(
      '@/composables/use-chat-context-budget-sync'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const contextUsage = useContextUsage()
    const sync = useChatContextBudgetSync()

    store.selectChat('proj', 'chat-a')
    expect(store.chatId.value).toBe('chat-a')
    expect(store.meta.value).toBeNull()
    expect(store.loading.value).toBe(false)

    contextUsage.setBudget({
      modelId: 'test/model',
      limit: 262_000,
      promptUsed: 5_000,
      reservedOutput: 33_000,
      safetyBuffer: 2_000,
      free: 222_000,
      used: 5_000,
      buckets: [{ id: 'messages', label: 'Conversation', tokens: 5_000 }],
    })
    contextUsage.setLastStepUsage({
      promptTokens: 51_000,
      inputTokens: 51_000,
      outputTokens: 1_200,
      cacheReadTokens: 47_000,
      cacheWriteTokens: 0,
    })
    expect(contextUsage.promptUsed.value).toBe(51_000)

    await sync.refreshContextBudget()
    await nextTick()
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0)
    })

    expect(store.meta.value).toBeNull()
    expect(store.loading.value).toBe(false)
    expect(contextUsage.lastStepUsage.value?.inputTokens).toBe(51_000)
    expect(contextUsage.promptUsed.value).toBe(51_000)
  })
})

describe('truncate merges harnessWake messages', () => {
  const userMessage = (
    id: string,
    text: string,
    createdAt?: string,
    harnessWake?: boolean,
  ) => ({
    id,
    role: 'user' as const,
    parts: [{ type: 'text' as const, text }],
    metadata: {
      ...(createdAt ? { createdAt } : {}),
      ...(harnessWake ? { harnessWake: true } : {}),
    },
  })

  const assistantTurn = (id: string, createdAt: string) => ({
    id,
    steps: [],
    text: 'ok',
    createdAt,
  })

  it('keeps a wake strictly before a truncated user message', async () => {
    const { createSession } = await import('@/composables/chat-store/helpers')
    const { createSessionMutations } = await import(
      '@/composables/chat-store/session-mutations'
    )
    const session = createSession('proj', 'chat-trunc-before')
    const first = userMessage('u1', 'first', '2026-01-01T00:00:00.000Z')
    const wake = userMessage(
      'wake-1',
      'wake body',
      '2026-01-01T00:00:02.000Z',
      true,
    )
    const second = userMessage('u2', 'second', '2026-01-01T00:00:03.000Z')
    const turn = assistantTurn('a1', '2026-01-01T00:00:01.000Z')
    session.timeline.value = [
      { type: 'user', message: first },
      { type: 'agent-turn', turn },
      { type: 'user', message: second },
    ]
    session.messages.value = [
      first,
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'ok' }], metadata: { createdAt: turn.createdAt } },
      wake,
      second,
    ]
    const api = createSessionMutations(session)
    await api.truncateBeforeMessage('proj', 'chat-trunc-before', 'u2')

    expect(session.timeline.value.map((item) => item.type)).toEqual([
      'user',
      'agent-turn',
    ])
    expect(session.messages.value.map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'wake-1',
    ])
    expect(session.messages.value[2]?.metadata).toMatchObject({ harnessWake: true })
  })

  it('keeps a wake through the last user and drops a later wake', async () => {
    const { createSession } = await import('@/composables/chat-store/helpers')
    const { createSessionMutations } = await import(
      '@/composables/chat-store/session-mutations'
    )
    const session = createSession('proj', 'chat-trunc-after')
    const first = userMessage('u1', 'first', '2026-01-01T00:00:01.000Z')
    const keptWake = userMessage(
      'wake-keep',
      'kept wake',
      '2026-01-01T00:00:00.000Z',
      true,
    )
    const laterWake = userMessage(
      'wake-drop',
      'later wake',
      '2026-01-01T00:00:02.000Z',
      true,
    )
    session.timeline.value = [{ type: 'user', message: first }]
    session.messages.value = [first, keptWake, laterWake]
    const api = createSessionMutations(session)
    await api.truncateAfterLastUserMessage('proj', 'chat-trunc-after')

    expect(session.timeline.value).toEqual([{ type: 'user', message: first }])
    expect(session.messages.value.map((message) => message.id)).toEqual([
      'wake-keep',
      'u1',
    ])
  })

  it('drops a wake after the kept user when truncating after that user', async () => {
    const { createSession } = await import('@/composables/chat-store/helpers')
    const { createSessionMutations } = await import(
      '@/composables/chat-store/session-mutations'
    )
    const session = createSession('proj', 'chat-trunc-after-user')
    const first = userMessage('u1', 'first', '2026-01-01T00:00:00.000Z')
    const second = userMessage('u2', 'second', '2026-01-01T00:00:03.000Z')
    const wake = userMessage(
      'wake-1',
      'wake after first',
      '2026-01-01T00:00:01.000Z',
      true,
    )
    session.timeline.value = [
      { type: 'user', message: first },
      { type: 'user', message: second },
    ]
    session.messages.value = [first, wake, second]
    const api = createSessionMutations(session)
    await api.truncateAfterUserMessage('proj', 'chat-trunc-after-user', 'u1')

    expect(session.messages.value.map((message) => message.id)).toEqual(['u1'])
  })

  it('leaves rebuilt messages when the boundary user has no createdAt', async () => {
    const { mergeHarnessWakeMessages } = await import(
      '@/composables/chat-store/merge-harness-wake-messages'
    )
    const first = userMessage('u1', 'first')
    const wake = userMessage(
      'wake-1',
      'wake body',
      '2026-01-01T00:00:01.000Z',
      true,
    )
    expect(
      mergeHarnessWakeMessages(
        [first],
        [first, wake],
        undefined,
        'through',
        first.id,
      ).map((message) => message.id),
    ).toEqual(['u1'])
  })

  it('drops a wake that has no createdAt', async () => {
    const { mergeHarnessWakeMessages } = await import(
      '@/composables/chat-store/merge-harness-wake-messages'
    )
    const first = userMessage('u1', 'first', '2026-01-01T00:00:00.000Z')
    const wake = userMessage(
      'wake-1',
      'wake body',
      undefined,
      true,
    )
    expect(
      mergeHarnessWakeMessages(
        [first],
        [first, wake],
        '2026-01-01T00:00:00.000Z',
        'through',
        first.id,
      ).map((message) => message.id),
    ).toEqual(['u1'])
  })

  it('keeps a same-timestamp wake that appears before the boundary', async () => {
    const { mergeHarnessWakeMessages } = await import(
      '@/composables/chat-store/merge-harness-wake-messages'
    )
    const stamp = '2026-01-01T00:00:03.000Z'
    const first = userMessage('u1', 'first', '2026-01-01T00:00:00.000Z')
    const wake = userMessage('wake-1', 'wake body', stamp, true)
    const second = userMessage('u2', 'second', stamp)
    expect(
      mergeHarnessWakeMessages(
        [first],
        [first, wake, second],
        stamp,
        'before',
        second.id,
      ).map((message) => message.id),
    ).toEqual(['u1', 'wake-1'])
    expect(
      mergeHarnessWakeMessages(
        [second],
        [wake, second],
        stamp,
        'through',
        second.id,
      ).map((message) => message.id),
    ).toEqual(['wake-1', 'u2'])
  })

  it('drops a same-timestamp wake that appears after the boundary', async () => {
    const { mergeHarnessWakeMessages } = await import(
      '@/composables/chat-store/merge-harness-wake-messages'
    )
    const stamp = '2026-01-01T00:00:00.000Z'
    const first = userMessage('u1', 'first', stamp)
    const wake = userMessage('wake-1', 'wake body', stamp, true)
    expect(
      mergeHarnessWakeMessages(
        [first],
        [first, wake],
        stamp,
        'through',
        first.id,
      ).map((message) => message.id),
    ).toEqual(['u1'])
    expect(
      mergeHarnessWakeMessages(
        [],
        [first, wake],
        stamp,
        'before',
        first.id,
      ).map((message) => message.id),
    ).toEqual([])
  })
})
