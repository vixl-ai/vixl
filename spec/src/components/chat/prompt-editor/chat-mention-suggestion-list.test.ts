import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ChatMentionSuggestionList from '@/components/chat/prompt-editor/ChatMentionSuggestionList.vue'

const scrollOptionIntoMenu = vi.hoisted(() =>
  vi.fn<(container: HTMLElement, option: HTMLElement) => void>(),
)

vi.mock('@/components/chat/prompt-editor/scroll-option-into-menu', () => ({
  scrollOptionIntoMenu,
}))

type ListExposed = {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const files = ['src/a.ts', 'src/b.ts', 'src/c.ts']

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  scrollOptionIntoMenu.mockClear()
})

describe('ChatMentionSuggestionList', () => {
  it('scrolls the newly selected row after ArrowDown', async () => {
    wrapper = mount(ChatMentionSuggestionList, {
      props: {
        items: files,
        query: '',
        command: () => undefined,
      },
    })
    const list = wrapper.vm as unknown as ListExposed

    expect(list.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(
      true,
    )
    await nextTick()

    expect(scrollOptionIntoMenu).toHaveBeenCalledTimes(1)
    const [container, option] = scrollOptionIntoMenu.mock.calls[0]!
    expect(container).toBe(wrapper.get('[data-chat-mention-suggestion]').element)
    expect(option.getAttribute('data-option-index')).toBe('1')
  })
})
