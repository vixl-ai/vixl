import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ChatSkillSuggestionList from '@/components/chat/prompt-editor/ChatSkillSuggestionList.vue'
import type { SlashIndexEntry } from '@/types/chat/slash-index-entry'

const scrollOptionIntoMenu = vi.hoisted(() =>
  vi.fn<(container: HTMLElement, option: HTMLElement) => void>(),
)

vi.mock('@/components/chat/prompt-editor/scroll-option-into-menu', () => ({
  scrollOptionIntoMenu,
}))

type ListExposed = {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const skills: SlashIndexEntry[] = [
  { kind: 'skill', name: 'ask', description: 'Ask', scope: 'project' },
  { kind: 'skill', name: 'plan', description: 'Plan', scope: 'project' },
  { kind: 'skill', name: 'agent', description: 'Agent', scope: 'project' },
]

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  scrollOptionIntoMenu.mockClear()
})

const mountList = (): VueWrapper => {
  wrapper = mount(ChatSkillSuggestionList, {
    props: {
      items: skills,
      query: '',
      command: () => undefined,
    },
  })
  return wrapper
}

describe('ChatSkillSuggestionList', () => {
  it('scrolls the newly selected row after ArrowDown', async () => {
    const mounted = mountList()
    const list = mounted.vm as unknown as ListExposed

    expect(list.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(
      true,
    )
    await nextTick()

    expect(scrollOptionIntoMenu).toHaveBeenCalledTimes(1)
    const [container, option] = scrollOptionIntoMenu.mock.calls[0]!
    expect(container).toBe(mounted.get('[data-chat-skill-suggestion]').element)
    expect(option.getAttribute('data-option-index')).toBe('1')
  })

  it('does not scroll on mouseenter', async () => {
    const mounted = mountList()

    await mounted.get('[data-option-index="2"]').trigger('mouseenter')
    await nextTick()

    expect(scrollOptionIntoMenu).not.toHaveBeenCalled()
  })
})
