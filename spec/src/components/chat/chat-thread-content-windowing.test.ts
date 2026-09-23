import { afterEach, describe, expect, it, vi } from 'vitest'
import { shallowMount, type VueWrapper } from '@vue/test-utils'

vi.hoisted(() => {
  Object.defineProperty(document, 'queryCommandSupported', {
    configurable: true,
    value: () => false,
  })
})

import ChatAgentTurn from '@/components/chat/ChatAgentTurn.vue'
import ChatThreadContent from '@/components/chat/ChatThreadContent.vue'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const scroller = vi.hoisted(() => ({
  scrollToEnd: vi.fn<(...args: unknown[]) => void>(),
  handleContentChange: vi.fn<() => void>(),
  windowedMessageIds: { value: null as Set<string> | null },
  itemPlaceholderHeight: vi.fn<(messageId: string) => number>((_messageId: string) => 160),
  setItemIds: vi.fn<(ids: string[]) => void>(),
  setPinnedMessageIds: vi.fn<(ids: string[]) => void>(),
}))

vi.mock('@/components/shadcn/ui/message-scroller/useMessageScroller', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/components/shadcn/ui/message-scroller/useMessageScroller')
    >()
  return {
    ...actual,
    useMessageScroller: () => ({
      scrollToEnd: scroller.scrollToEnd,
      scrollToMessage: vi.fn<(...args: unknown[]) => void>(),
      scrollToStart: vi.fn<(...args: unknown[]) => void>(),
    }),
    useMessageScrollerContext: () => ({
      handleContentChange: scroller.handleContentChange,
      scrollToEnd: scroller.scrollToEnd,
      windowedMessageIds: scroller.windowedMessageIds,
      itemPlaceholderHeight: scroller.itemPlaceholderHeight,
      setItemIds: scroller.setItemIds,
      setPinnedMessageIds: scroller.setPinnedMessageIds,
    }),
  }
})

const makeTurn = (id: string): AgentTurn => ({
  id,
  text: '',
  steps: [
    {
      id: `${id}-step`,
      text: '',
      reasoning: '',
      tools: [],
    },
  ],
})

const agentTurn = (id: string): ChatTimelineItem => ({
  type: 'agent-turn',
  turn: makeTurn(id),
})

const userItem = (id: string, text: string): ChatTimelineItem => ({
  type: 'user',
  message: {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  },
})

const agentTurnStub = {
  name: 'ChatAgentTurn',
  props: [
    'turn',
    'status',
    'activityLabel',
    'subagentsByToolCallId',
    'subagentsById',
    'restoreEnabled',
    'chatFileChanges',
    'restoreChanges',
    'restoreDiscardsLatestMessage',
  ],
  template: '<div data-testid="agent-turn" />',
}

const scrollerItemStub = {
  name: 'MessageScrollerItem',
  props: ['messageId', 'scrollAnchor', 'placeholderHeight'],
  template:
    '<div :data-message-id="messageId"><slot v-if="placeholderHeight == null" /></div>',
}

let wrapper: VueWrapper | null = null

const mountContent = (
  timeline: ChatTimelineItem[],
  status: 'ready' | 'streaming' | 'submitted' = 'ready',
): VueWrapper => {
  wrapper = shallowMount(ChatThreadContent, {
    props: {
      timeline,
      pendingApprovals: [],
      status,
    },
    global: {
      stubs: {
        ChatAgentTurn: agentTurnStub,
        ChatMessageTurn: true,
        ChatSubAgentTurn: true,
        ChatCompactionMarker: true,
        ChatQuestionCard: true,
        ChatMcpAuthCard: true,
        AiElementsShimmerShimmer: {
          name: 'AiElementsShimmerShimmer',
          template: '<span><slot /></span>',
        },
        MessageScroller: { name: 'MessageScroller', template: '<div><slot /></div>' },
        MessageScrollerViewport: {
          name: 'MessageScrollerViewport',
          template: '<div><slot /></div>',
        },
        MessageScrollerContent: {
          name: 'MessageScrollerContent',
          template: '<div><slot /></div>',
        },
        MessageScrollerItem: scrollerItemStub,
      },
    },
  })
  return wrapper
}

const agentTurns = (mounted: VueWrapper) => {
  const byRef = mounted.findAllComponents(ChatAgentTurn)
  if (byRef.length > 0) {
    return byRef
  }
  return mounted.findAllComponents({ name: 'ChatAgentTurn' })
}

const scrollerItems = (mounted: VueWrapper) =>
  mounted.findAllComponents({ name: 'MessageScrollerItem' })

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  scroller.scrollToEnd.mockClear()
  scroller.handleContentChange.mockClear()
  scroller.setItemIds.mockClear()
  scroller.setPinnedMessageIds.mockClear()
  scroller.itemPlaceholderHeight.mockClear()
  scroller.itemPlaceholderHeight.mockImplementation((_messageId: string) => 160)
  scroller.windowedMessageIds.value = null
})

describe('ChatThreadContent windowing', () => {
  it('registers every timeline item id with the scroller', () => {
    mountContent([userItem('u1', 'hi'), agentTurn('t1'), agentTurn('t2')])

    expect(scroller.setItemIds).toHaveBeenCalled()
    const lastCall = scroller.setItemIds.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual(['u1', 't1', 't2'])
  })

  it('renders only windowed turns as real components', () => {
    scroller.windowedMessageIds.value = new Set(['t1'])
    const mounted = mountContent([agentTurn('t1'), agentTurn('t2'), agentTurn('t3')])

    const turns = agentTurns(mounted)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.props('turn')).toMatchObject({ id: 't1' })

    const items = scrollerItems(mounted)
    expect(items).toHaveLength(3)
    expect(items[0]?.props('placeholderHeight')).toBeUndefined()
    expect(items[1]?.props('placeholderHeight')).toBe(160)
    expect(items[2]?.props('placeholderHeight')).toBe(160)
  })

  it('puts last measured heights on off-window placeholders', () => {
    scroller.itemPlaceholderHeight.mockImplementation((messageId: string) => {
      if (messageId === 't1') {
        return 240
      }
      if (messageId === 't3') {
        return 88
      }
      return 160
    })
    scroller.windowedMessageIds.value = new Set(['t2'])
    const mounted = mountContent([agentTurn('t1'), agentTurn('t2'), agentTurn('t3')])

    const items = scrollerItems(mounted)
    expect(items[0]?.props('placeholderHeight')).toBe(240)
    expect(items[1]?.props('placeholderHeight')).toBeUndefined()
    expect(items[2]?.props('placeholderHeight')).toBe(88)
    expect(agentTurns(mounted)).toHaveLength(1)
    expect(agentTurns(mounted)[0]?.props('turn')).toMatchObject({ id: 't2' })
  })

  it('keeps the live streaming tail mounted even when it is outside the window', () => {
    scroller.windowedMessageIds.value = new Set(['u1'])
    const mounted = mountContent(
      [userItem('u1', 'go'), agentTurn('t1'), agentTurn('t2')],
      'streaming',
    )

    const turns = agentTurns(mounted)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.props('turn')).toMatchObject({ id: 't2' })
    expect(turns[0]?.props('status')).toBe('streaming')

    const items = scrollerItems(mounted)
    expect(items).toHaveLength(3)
    expect(items[0]?.props('placeholderHeight')).toBeUndefined()
    expect(items[1]?.props('placeholderHeight')).toBe(160)
    expect(items[2]?.props('placeholderHeight')).toBeUndefined()
    expect(scroller.setPinnedMessageIds.mock.calls.at(-1)?.[0]).toEqual(['t2'])
  })

  it('does not pin the last turn when the thread is idle', () => {
    scroller.windowedMessageIds.value = new Set(['u1'])
    const mounted = mountContent([userItem('u1', 'go'), agentTurn('t1')])

    expect(agentTurns(mounted)).toHaveLength(0)
    expect(scrollerItems(mounted)[1]?.props('placeholderHeight')).toBe(160)
    expect(scroller.setPinnedMessageIds.mock.calls.at(-1)?.[0]).toEqual([])
  })
})
