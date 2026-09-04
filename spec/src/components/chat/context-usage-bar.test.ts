import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ContextUsageBar from '@/components/chat/ContextUsageBar.vue'
import useChatContextActions from '@/composables/use-chat-context-actions'
import useContextUsage from '@/composables/use-context-usage'

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/composables/use-chat-store', () => ({
  default: () => ({
    meta: { value: null },
  }),
}))

const ringTrigger = (wrapper: VueWrapper): HTMLButtonElement => {
  const match = wrapper.findAll('button').find((button) => button.find('svg').exists())
  if (!match || !(match.element instanceof HTMLButtonElement)) {
    throw new Error('Context ring trigger was not found')
  }
  return match.element
}

const bodyButton = (label: string): HTMLButtonElement => {
  const match = Array.from(document.body.querySelectorAll('button')).find(
    (button) =>
      button instanceof HTMLButtonElement && button.textContent?.includes(label),
  )
  if (!match || !(match instanceof HTMLButtonElement)) {
    throw new Error(`${label} button was not found`)
  }
  return match
}

const openPopover = async (wrapper: VueWrapper): Promise<void> => {
  const trigger = wrapper.findAll('button').find((button) => button.find('svg').exists())
  if (!trigger) {
    throw new Error('Context ring trigger was not found')
  }
  await trigger.trigger('click')
  await nextTick()
}

describe('ContextUsageBar', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    const contextActions = useChatContextActions()
    contextActions.clear()
    useContextUsage().pending.value = false
    contextActions.register({
      onCompact: () => undefined,
      onHandoff: () => undefined,
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    useChatContextActions().clear()
    useContextUsage().pending.value = false
  })

  it('keeps the ring enabled while Compact and Handoff disable', async () => {
    wrapper = mount(ContextUsageBar, { attachTo: document.body })
    const contextActions = useChatContextActions()
    useContextUsage().pending.value = true
    contextActions.compacting.value = true
    contextActions.setDisabled({ actionsDisabled: true })
    await nextTick()

    expect(ringTrigger(wrapper).disabled).toBe(false)

    await openPopover(wrapper)

    expect(bodyButton('Compacting').disabled).toBe(true)
    expect(bodyButton('Handoff').disabled).toBe(true)
  })

  it('does not disable the ring or actions from pending alone', async () => {
    wrapper = mount(ContextUsageBar, { attachTo: document.body })
    const contextActions = useChatContextActions()
    useContextUsage().pending.value = true
    contextActions.compacting.value = false
    contextActions.setDisabled({ actionsDisabled: false })
    await nextTick()

    expect(ringTrigger(wrapper).disabled).toBe(false)

    await openPopover(wrapper)

    expect(bodyButton('Compact').disabled).toBe(false)
    expect(bodyButton('Handoff').disabled).toBe(false)
  })
})
