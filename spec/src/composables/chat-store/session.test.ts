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

    await store.loadChat('proj', 'chat-b')
    const sessionB = store.forChat('proj', 'chat-b')
    sessionB.startAgentTurn('turn-b')
    sessionB.appendLocalTextDelta('hello from B', 'turn-b')

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
    // Mark warm without wiping timeline: loadChat on empty disk after mutations
    // would hydrate empty. Use isSessionWarm via create path instead.
    await store.loadChat('proj', 'chat-a')
    // After cold hydrate the timeline is empty from disk; seed again on warm session
    const warmA = store.forChat('proj', 'chat-a')
    warmA.startAgentTurn('turn-a')
    warmA.appendLocalTextDelta('keep me', 'turn-a')

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
