import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
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

const subagentOf = (
  timeline: { value: ChatTimelineItem[] },
  subagentId: string,
): SubagentTimelineItem | null => {
  const item = timeline.value.find(
    (entry) => entry.type === 'subagent' && entry.subagentId === subagentId,
  )
  return item?.type === 'subagent' ? item : null
}

describe('subagent stream delta batching', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('coalesces many reasoning deltas into one timeline write after flush', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { STREAM_DELTA_FLUSH_MS } = await import(
      '@/composables/chat-store/stream-delta-buffer'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'sub-batch')
    session.upsertLocalSubagentStart({
      subagentId: 'sub-1',
      name: 'explore',
      blocking: false,
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'step-start',
      stepId: 's1',
    })

    let timelineUpdates = 0
    const stop = watch(
      session.timeline,
      () => {
        timelineUpdates += 1
      },
      { flush: 'sync' },
    )

    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'reasoning-delta',
      delta: 'Hel',
      stepId: 's1',
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'reasoning-delta',
      delta: 'lo ',
      stepId: 's1',
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'reasoning-delta',
      delta: 'world',
      stepId: 's1',
    })
    expect(subagentOf(session.timeline, 'sub-1')?.steps?.[0]?.reasoning).toBe('')
    expect(timelineUpdates).toBe(0)

    await vi.advanceTimersByTimeAsync(STREAM_DELTA_FLUSH_MS)
    expect(subagentOf(session.timeline, 'sub-1')?.steps?.[0]?.reasoning).toBe(
      'Hello world',
    )
    expect(timelineUpdates).toBe(1)
    stop()
  })

  it('flushes pending reasoning before a following tool-start', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'sub-order')
    session.upsertLocalSubagentStart({
      subagentId: 'sub-1',
      name: 'explore',
      blocking: false,
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'step-start',
      stepId: 's1',
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'reasoning-delta',
      delta: 'before tool',
      stepId: 's1',
    })
    expect(subagentOf(session.timeline, 'sub-1')?.steps?.[0]?.reasoning).toBe('')

    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'tool-start',
      toolCallId: 'tc-1',
      name: 'read_file',
      args: { path: 'a.ts' },
    })

    const item = subagentOf(session.timeline, 'sub-1')
    expect(item?.steps?.[0]?.reasoning).toBe('before tool')
    expect(item?.steps?.[0]?.tools[0]?.toolCallId).toBe('tc-1')
  })

  it('does not concatenate a text-delta from a different subagent', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    const { STREAM_DELTA_FLUSH_MS } = await import(
      '@/composables/chat-store/stream-delta-buffer'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'sub-isolate')
    session.upsertLocalSubagentStart({
      subagentId: 'sub-1',
      name: 'explore',
      blocking: false,
    })
    session.upsertLocalSubagentStart({
      subagentId: 'sub-2',
      name: 'review',
      blocking: false,
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'step-start',
      stepId: 's1',
    })
    session.appendLocalSubagentToolEvent('sub-2', {
      type: 'step-start',
      stepId: 's2',
    })

    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'reasoning-delta',
      delta: 'alpha',
      stepId: 's1',
    })
    session.appendLocalSubagentToolEvent('sub-2', {
      type: 'text-delta',
      delta: 'bravo',
      stepId: 's2',
    })

    await vi.advanceTimersByTimeAsync(STREAM_DELTA_FLUSH_MS)

    expect(subagentOf(session.timeline, 'sub-1')?.steps?.[0]?.reasoning).toBe('alpha')
    expect(subagentOf(session.timeline, 'sub-1')?.steps?.[0]?.text).toBe('')
    expect(subagentOf(session.timeline, 'sub-2')?.steps?.[0]?.text).toBe('bravo')
    expect(subagentOf(session.timeline, 'sub-2')?.steps?.[0]?.reasoning).toBe('')
  })

  it('flushes pending deltas before step-content so the snapshot wins', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'sub-content')
    session.upsertLocalSubagentStart({
      subagentId: 'sub-1',
      name: 'explore',
      blocking: false,
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'step-start',
      stepId: 's1',
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'reasoning-delta',
      delta: 'partial',
      stepId: 's1',
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'step-content',
      stepId: 's1',
      reasoning: 'final reasoning',
      reasoningSeconds: 2,
      text: 'final text',
    })

    const step = subagentOf(session.timeline, 'sub-1')?.steps?.[0]
    expect(step?.reasoning).toBe('final reasoning')
    expect(step?.text).toBe('final text')
  })

  it('flushes pending deltas when the subagent completes', async () => {
    const { default: useChatStore, resetChatSessionsForTests } = await import(
      '@/composables/use-chat-store'
    )
    resetChatSessionsForTests()
    const store = useChatStore()
    const session = store.forChat('proj', 'sub-complete')
    session.upsertLocalSubagentStart({
      subagentId: 'sub-1',
      name: 'explore',
      blocking: false,
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'step-start',
      stepId: 's1',
    })
    session.appendLocalSubagentToolEvent('sub-1', {
      type: 'text-delta',
      delta: 'tail',
      stepId: 's1',
    })
    session.completeLocalSubagent('sub-1', 'done summary', 'done')

    const item = subagentOf(session.timeline, 'sub-1')
    expect(item?.steps?.[0]?.text).toBe('tail')
    expect(item?.status).toBe('done')
    expect(item?.summary).toBe('done summary')
  })
})
