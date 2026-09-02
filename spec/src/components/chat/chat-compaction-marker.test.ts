import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatCompactionMarker from '@/components/chat/ChatCompactionMarker.vue'

const markerClass = (wrapper: ReturnType<typeof mount>): string => {
  const marker = wrapper.get('[data-slot="marker"]')
  return marker.classes().join(' ')
}

describe('ChatCompactionMarker', () => {
  it('shows Compacted when finished', () => {
    const wrapper = mount(ChatCompactionMarker)
    expect(wrapper.text()).toContain('Compacted')
    expect(wrapper.text()).not.toContain('Compacting')
    expect(markerClass(wrapper)).toContain('border-b')
  })

  it('shows Compacting when pending', () => {
    const wrapper = mount(ChatCompactionMarker, {
      props: { pending: true },
    })
    expect(wrapper.text()).toContain('Compacting')
    expect(markerClass(wrapper)).not.toContain('border-b')
    expect(markerClass(wrapper)).not.toContain('pb-2')
  })
})
