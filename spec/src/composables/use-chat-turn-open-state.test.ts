import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import {
  CHAT_TURN_OPEN_STATE_KEY,
  chatTurnOpenKeys,
  collectChatTurnOpenLiveIds,
  createChatTurnOpenState,
  usePersistedCollapsibleOpen,
} from '@/composables/use-chat-turn-open-state'

const Harness = defineComponent({
  props: {
    persistId: {
      type: String,
      required: true,
    },
    defaultOpen: {
      type: Boolean,
      default: false,
    },
    restore: {
      type: Boolean,
      default: true,
    },
    write: {
      type: Boolean,
      default: true,
    },
  },
  setup(props) {
    const { open, setProgrammatic } = usePersistedCollapsibleOpen(() => props.persistId, {
      defaultOpen: () => props.defaultOpen,
      restore: () => props.restore,
      write: () => props.write,
    })
    return { open, setProgrammatic }
  },
  template: '<button type="button" @click="open = !open">{{ open ? "open" : "closed" }}</button>',
})

const mountHarness = (
  persistId: string,
  store: ReturnType<typeof createChatTurnOpenState>,
  extra: { defaultOpen?: boolean, restore?: boolean, write?: boolean } = {},
): VueWrapper =>
  mount(Harness, {
    props: {
      persistId,
      defaultOpen: extra.defaultOpen ?? false,
      restore: extra.restore ?? true,
      write: extra.write ?? true,
    },
    global: {
      provide: {
        [CHAT_TURN_OPEN_STATE_KEY]: store,
      },
    },
  })

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('createChatTurnOpenState', () => {
  it('does not grow the map until a value is written', () => {
    const store = createChatTurnOpenState()
    expect(store.size()).toBe(0)
    expect(store.get('tool:abc')).toBeUndefined()
  })

  it('prunes keys whose turn or tool id is no longer live', () => {
    const store = createChatTurnOpenState()
    store.set(chatTurnOpenKeys.tool('old-tool'), true)
    store.set(chatTurnOpenKeys.filesChanged('old-turn'), true)
    store.set(chatTurnOpenKeys.reasoning('keep-turn', 'step-1'), true)

    store.prune(new Set(['keep-turn']))

    expect(store.get(chatTurnOpenKeys.tool('old-tool'))).toBeUndefined()
    expect(store.get(chatTurnOpenKeys.filesChanged('old-turn'))).toBeUndefined()
    expect(store.get(chatTurnOpenKeys.reasoning('keep-turn', 'step-1'))).toBe(true)
    expect(store.size()).toBe(1)
  })

  it('keeps every user-set entry without evicting older expansions', () => {
    const store = createChatTurnOpenState()
    const first = chatTurnOpenKeys.tool('first-tool')
    store.set(first, true)
    for (let index = 0; index < 500; index += 1) {
      store.set(chatTurnOpenKeys.tool(`tool-${index}`), true)
    }

    expect(store.size()).toBe(501)
    expect(store.get(first)).toBe(true)
    expect(store.get(chatTurnOpenKeys.tool('tool-499'))).toBe(true)
  })
})

describe('collectChatTurnOpenLiveIds', () => {
  it('collects turn ids and tool call ids from the timeline', () => {
    const timeline: ChatTimelineItem[] = [
      {
        type: 'agent-turn',
        turn: {
          id: 'turn-1',
          text: '',
          steps: [
            {
              id: 'step-1',
              text: '',
              reasoning: '',
              tools: [{ toolCallId: 'tool-1', name: 'read_file', status: 'done' }],
            },
          ],
        },
      },
      {
        type: 'subagent',
        subagentId: 'sub-1',
        name: 'explore',
        blocking: false,
        status: 'done',
        tools: [{ toolCallId: 'tool-2', name: 'read_file', status: 'done' }],
        compactions: [],
      },
    ]

    expect([...collectChatTurnOpenLiveIds(timeline)].sort()).toEqual([
      'tool-1',
      'tool-2',
      'turn-1',
    ])
  })
})

describe('usePersistedCollapsibleOpen', () => {
  it('restores user-expanded state after unmount and remount', async () => {
    const store = createChatTurnOpenState()
    const id = chatTurnOpenKeys.tool('tc-1')
    wrapper = mountHarness(id, store)
    expect(wrapper.text()).toBe('closed')
    expect(store.size()).toBe(0)

    await wrapper.get('button').trigger('click')
    await nextTick()
    expect(wrapper.text()).toBe('open')
    expect(store.get(id)).toBe(true)

    wrapper.unmount()
    wrapper = mountHarness(id, store)
    expect(wrapper.text()).toBe('open')
    expect(store.size()).toBe(1)
  })

  it('does not write when the user never toggles a collapsed default', () => {
    const store = createChatTurnOpenState()
    wrapper = mountHarness(chatTurnOpenKeys.tool('tc-untouched'), store)
    expect(wrapper.text()).toBe('closed')
    expect(store.size()).toBe(0)
  })

  it('does not persist programmatic streaming open or close', async () => {
    const store = createChatTurnOpenState()
    const id = chatTurnOpenKeys.reasoning('turn-1', 'step-1')
    wrapper = mountHarness(id, store, { write: false })
    const harness = wrapper.vm as typeof wrapper.vm & {
      setProgrammatic: (value: boolean) => void
    }
    harness.setProgrammatic(true)
    await nextTick()
    expect(wrapper.text()).toBe('open')
    expect(store.size()).toBe(0)

    harness.setProgrammatic(false)
    await nextTick()
    expect(wrapper.text()).toBe('closed')
    expect(store.size()).toBe(0)
  })

  it('does not restore persisted state while restore is disabled (live stream)', () => {
    const store = createChatTurnOpenState()
    const id = chatTurnOpenKeys.reasoning('turn-1', 'step-1')
    store.set(id, true)
    wrapper = mountHarness(id, store, { defaultOpen: false, restore: false })
    expect(wrapper.text()).toBe('closed')
  })
})
