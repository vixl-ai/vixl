import { computed, defineComponent, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TerminalCopyButton from '@/components/ai-elements/terminal/TerminalCopyButton.vue'
import { TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { TerminalKey } from '@/components/ai-elements/terminal/context'

const slotText = (nodes: VNode[] | undefined): string => {
  if (!nodes) {
    return ''
  }
  return nodes
    .map((node) => (typeof node.children === 'string' ? node.children : ''))
    .join('')
}

const Host = defineComponent({
  components: { TerminalCopyButton, TooltipProvider },
  template: '<TooltipProvider><TerminalCopyButton /></TooltipProvider>',
})

describe('TerminalCopyButton', () => {
  it('shows a Copy tooltip', () => {
    const wrapper = mount(Host, {
      global: {
        provide: {
          [TerminalKey as symbol]: {
            output: computed(() => 'echo hi'),
            isStreaming: computed(() => false),
            autoScroll: computed(() => true),
            hasClear: computed(() => false),
            onClear: () => {},
          },
        },
      },
    })

    expect(wrapper.get('[aria-label="Copy"]').attributes('aria-label')).toBe('Copy')
    const content = wrapper.findComponent(TooltipContent)
    expect(content.exists()).toBe(true)
    const render = content.vm.$slots.default as
      | ((props: Record<string, unknown>) => VNode[])
      | undefined
    expect(slotText(render?.({}))).toBe('Copy')
  })
})
