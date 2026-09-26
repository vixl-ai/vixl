import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { Collapsible } from '@/components/shadcn/ui/collapsible'
import ChatToolRun from '@/components/chat/ChatToolRun.vue'
import ChatTurnFilesChanged from '@/components/chat/ChatTurnFilesChanged.vue'
import { defineComponent } from 'vue'
import Reasoning from '@/components/ai-elements/reasoning/Reasoning.vue'
import ReasoningTrigger from '@/components/ai-elements/reasoning/ReasoningTrigger.vue'
import ChainOfThought from '@/components/ai-elements/chain-of-thought/ChainOfThought.vue'
import { useChainOfThought } from '@/components/ai-elements/chain-of-thought/context'
import {
  CHAT_TURN_OPEN_STATE_KEY,
  chatTurnOpenKeys,
  createChatTurnOpenState,
} from '@/composables/use-chat-turn-open-state'
import type { ToolRun } from '@/types/harness/tool-run'

vi.mock('@/utils/open-at-line', () => ({
  default: () => undefined,
}))

const filesStubs = {
  AlertDialog: { template: '<div><slot /></div>' },
  AlertDialogContent: { template: '<div><slot /></div>' },
  AlertDialogHeader: { template: '<div><slot /></div>' },
  AlertDialogTitle: { template: '<div><slot /></div>' },
  AlertDialogDescription: { template: '<div><slot /></div>' },
  AlertDialogFooter: { template: '<div><slot /></div>' },
  AlertDialogCancel: { template: '<button><slot /></button>' },
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: true,
  CommitFiles: { template: '<div><slot /></div>' },
  CommitFile: { template: '<div><slot /></div>' },
  CommitFileStatus: true,
  CommitFilePath: { template: '<span><slot /></span>' },
  CommitFileAdditions: true,
  CommitFileDeletions: true,
}

const toolRun = (): ToolRun => ({
  toolCallId: 'tc-persist',
  name: 'read_file',
  status: 'done',
  args: { path: 'a.ts' },
})

const provideStore = (store: ReturnType<typeof createChatTurnOpenState>) => ({
  [CHAT_TURN_OPEN_STATE_KEY]: store,
})

const ChainOfThoughtProbe = defineComponent({
  setup() {
    const { isOpen } = useChainOfThought()
    return { isOpen }
  },
  template: '<span data-testid="cot-open">{{ isOpen ? "open" : "closed" }}</span>',
})

const collapsibleOpen = (mounted: VueWrapper): boolean | undefined => {
  const byRef = mounted.findComponent(Collapsible)
  if (byRef.exists()) {
    return Boolean(byRef.props('open') ?? byRef.attributes('data-state') === 'open')
  }
  const named = mounted.findComponent({ name: 'Collapsible' })
  if (!named.exists()) {
    return undefined
  }
  return Boolean(named.props('open'))
}

const emitOpen = async (mounted: VueWrapper, open: boolean): Promise<void> => {
  const byRef = mounted.findComponent(Collapsible)
  const target = byRef.exists() ? byRef : mounted.findComponent({ name: 'Collapsible' })
  await target.vm.$emit('update:open', open)
  await flushPromises()
}

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('ChatToolRun open persist', () => {
  it('restores expanded state after remount and does not write when untouched', async () => {
    const store = createChatTurnOpenState()
    const key = chatTurnOpenKeys.tool('tc-persist')

    wrapper = mount(ChatToolRun, {
      props: { run: toolRun() },
      global: {
        provide: provideStore(store),
        stubs: {
          AiElementsShimmerShimmer: { template: '<span><slot /></span>' },
        },
      },
    })
    expect(store.size()).toBe(0)
    expect(collapsibleOpen(wrapper)).toBe(false)

    await emitOpen(wrapper, true)
    expect(store.get(key)).toBe(true)

    wrapper.unmount()
    wrapper = mount(ChatToolRun, {
      props: { run: toolRun() },
      global: {
        provide: provideStore(store),
        stubs: {
          AiElementsShimmerShimmer: { template: '<span><slot /></span>' },
        },
      },
    })
    expect(collapsibleOpen(wrapper)).toBe(true)
  })
})

describe('ChatTurnFilesChanged open persist', () => {
  it('restores expanded state after remount', async () => {
    const store = createChatTurnOpenState()
    const key = chatTurnOpenKeys.filesChanged('turn-1')
    const props = {
      persistKey: key,
      changes: [{ path: 'a.ts', operation: 'update' as const, additions: 1, deletions: 0 }],
    }

    wrapper = mount(ChatTurnFilesChanged, {
      props,
      global: { provide: provideStore(store), stubs: filesStubs },
    })
    expect(store.size()).toBe(0)

    await emitOpen(wrapper, true)
    expect(store.get(key)).toBe(true)

    wrapper.unmount()
    wrapper = mount(ChatTurnFilesChanged, {
      props,
      global: { provide: provideStore(store), stubs: filesStubs },
    })
    expect(collapsibleOpen(wrapper)).toBe(true)
  })
})

describe('Reasoning live streaming persist', () => {
  it('does not write auto-open or auto-close for a live streaming turn', async () => {
    vi.useFakeTimers()
    const store = createChatTurnOpenState()
    const key = chatTurnOpenKeys.reasoning('turn-1', 'step-1')

    wrapper = mount(Reasoning, {
      props: {
        persistKey: key,
        isStreaming: true,
        defaultOpen: false,
      },
      global: {
        provide: provideStore(store),
        stubs: {
          Collapsible: {
            name: 'Collapsible',
            props: ['open'],
            template: '<div><slot /></div>',
          },
        },
      },
    })

    expect(collapsibleOpen(wrapper)).toBe(true)
    expect(store.size()).toBe(0)

    await wrapper.setProps({ isStreaming: false })
    await vi.advanceTimersByTimeAsync(1100)
    await flushPromises()

    expect(collapsibleOpen(wrapper)).toBe(false)
    expect(store.size()).toBe(0)
  })

  it('restores a user-expanded historical reasoning block', () => {
    const store = createChatTurnOpenState()
    const key = chatTurnOpenKeys.reasoning('turn-1', 'step-1')
    store.set(key, true)

    wrapper = mount(Reasoning, {
      props: {
        persistKey: key,
        isStreaming: false,
        defaultOpen: false,
      },
      global: {
        provide: provideStore(store),
        stubs: {
          Collapsible: {
            name: 'Collapsible',
            props: ['open'],
            template: '<div><slot /></div>',
          },
        },
      },
    })

    expect(collapsibleOpen(wrapper)).toBe(true)
  })
})

const reasoningDurationStubs = {
  Collapsible: {
    name: 'Collapsible',
    props: ['open'],
    template: '<div><slot /></div>',
  },
  CollapsibleTrigger: {
    name: 'CollapsibleTrigger',
    template: '<button type="button"><slot /></button>',
  },
  Shimmer: {
    name: 'Shimmer',
    template: '<span><slot /></span>',
  },
}

const mountReasoningDuration = (props: {
  isStreaming?: boolean
  duration?: number
}): VueWrapper => {
  wrapper = mount(Reasoning, {
    props,
    slots: {
      default: ReasoningTrigger,
    },
    global: {
      stubs: reasoningDurationStubs,
    },
  })
  return wrapper
}

describe('Reasoning duration', () => {
  it('shows Thinking while streaming', () => {
    const mounted = mountReasoningDuration({
      isStreaming: true,
      duration: 4,
    })
    expect(mounted.text()).toContain('Thinking...')
    expect(mounted.text()).not.toContain('Thought for')
  })

  it('shows Thought for N seconds when a finished block has duration', () => {
    const mounted = mountReasoningDuration({
      isStreaming: false,
      duration: 4,
    })
    expect(mounted.text()).toContain('Thought for 4 seconds')
  })

  it('uses the singular second label for duration 1', () => {
    const mounted = mountReasoningDuration({
      isStreaming: false,
      duration: 1,
    })
    expect(mounted.text()).toContain('Thought for 1 second')
    expect(mounted.text()).not.toContain('seconds')
  })

  it('falls back to a few seconds when duration is missing', () => {
    const mounted = mountReasoningDuration({
      isStreaming: false,
    })
    expect(mounted.text()).toContain('Thought for a few seconds')
  })

  it('keeps a stored duration after remount and does not overwrite it when streaming flips', async () => {
    vi.useFakeTimers()
    const mounted = mountReasoningDuration({
      isStreaming: false,
      duration: 4,
    })
    expect(mounted.text()).toContain('Thought for 4 seconds')

    await mounted.setProps({ isStreaming: true })
    await vi.advanceTimersByTimeAsync(5000)
    await mounted.setProps({ isStreaming: false })
    await flushPromises()

    expect(mounted.text()).toContain('Thought for 4 seconds')
    expect(mounted.emitted('update:duration')).toBeUndefined()
  })

  it('fills the live label from the mounted timer then replaces it when duration arrives', async () => {
    vi.useFakeTimers()
    const mounted = mountReasoningDuration({
      isStreaming: true,
    })
    expect(mounted.text()).toContain('Thinking...')

    await vi.advanceTimersByTimeAsync(2000)
    await mounted.setProps({ isStreaming: false })
    await flushPromises()
    expect(mounted.text()).toContain('Thought for 2 seconds')

    await mounted.setProps({ duration: 9 })
    await flushPromises()
    expect(mounted.text()).toContain('Thought for 9 seconds')
  })

  it('does not overwrite a duration that arrives while the live clock is running', async () => {
    vi.useFakeTimers()
    const mounted = mountReasoningDuration({
      isStreaming: true,
    })

    await vi.advanceTimersByTimeAsync(3000)
    await mounted.setProps({ duration: 4 })
    expect(mounted.text()).toContain('Thinking...')

    await mounted.setProps({ isStreaming: false })
    await flushPromises()
    expect(mounted.text()).toContain('Thought for 4 seconds')
    expect(mounted.emitted('update:duration')).toBeUndefined()
  })
})

describe('ChainOfThought live streaming persist', () => {
  it('does not write auto-open or auto-close for a live streaming group', async () => {
    vi.useFakeTimers()
    const store = createChatTurnOpenState()
    const key = chatTurnOpenKeys.chainOfThought('turn-1', 'step-1', 0)

    wrapper = mount(ChainOfThought, {
      props: {
        persistKey: key,
        isStreaming: true,
        defaultOpen: false,
      },
      slots: {
        default: ChainOfThoughtProbe,
      },
      global: {
        provide: provideStore(store),
      },
    })

    expect(wrapper.get('[data-testid="cot-open"]').text()).toBe('open')
    expect(store.size()).toBe(0)

    await wrapper.setProps({ isStreaming: false })
    await vi.advanceTimersByTimeAsync(1100)
    await flushPromises()

    expect(wrapper.get('[data-testid="cot-open"]').text()).toBe('closed')
    expect(store.size()).toBe(0)
  })

  it('restores a user-expanded historical group', () => {
    const store = createChatTurnOpenState()
    const key = chatTurnOpenKeys.chainOfThought('turn-1', 'step-1', 0)
    store.set(key, true)

    wrapper = mount(ChainOfThought, {
      props: {
        persistKey: key,
        isStreaming: false,
        defaultOpen: false,
      },
      slots: {
        default: ChainOfThoughtProbe,
      },
      global: {
        provide: provideStore(store),
      },
    })

    expect(wrapper.get('[data-testid="cot-open"]').text()).toBe('open')
  })
})
