import { describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import ChatToolRun from '@/components/chat/ChatToolRun.vue'
import {
  Collapsible,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import type { ToolRun } from '@/types/harness/tool-run'

vi.mock('@/utils/open-at-line', () => ({
  default: () => undefined,
}))

const mountRun = (run: ToolRun) =>
  shallowMount(ChatToolRun, {
    props: { run },
    global: {
      renderStubDefaultSlot: true,
      stubs: {
        AiElementsShimmerShimmer: {
          name: 'AiElementsShimmerShimmer',
          template: '<span><slot /></span>',
        },
      },
    },
  })

const collapsibleCount = (wrapper: ReturnType<typeof mountRun>): number => {
  const byRef = wrapper.findAllComponents(Collapsible)
  if (byRef.length > 0) {
    return byRef.length
  }
  return wrapper.findAllComponents({ name: 'Collapsible' }).length
}

const triggerCount = (wrapper: ReturnType<typeof mountRun>): number => {
  const byRef = wrapper.findAllComponents(CollapsibleTrigger)
  if (byRef.length > 0) {
    return byRef.length
  }
  return wrapper.findAllComponents({ name: 'CollapsibleTrigger' }).length
}

describe('ChatToolRun empty running', () => {
  it('hides the collapsible when running with no args or result', () => {
    const wrapper = mountRun({
      toolCallId: 'tc-empty',
      name: 'update_todos',
      status: 'running',
    })

    expect(collapsibleCount(wrapper)).toBe(0)
    expect(triggerCount(wrapper)).toBe(0)
    expect(wrapper.html()).not.toContain('Running…')
    expect(wrapper.html()).not.toMatch(/chevron/i)
    expect(wrapper.html()).toMatch(/todos/i)
  })

  it('renders the collapsible when running with args', () => {
    const wrapper = mountRun({
      toolCallId: 'tc-args',
      name: 'update_todos',
      status: 'running',
      args: { todos: [] },
    })

    expect(collapsibleCount(wrapper)).toBe(1)
    expect(triggerCount(wrapper)).toBe(1)
  })
})
