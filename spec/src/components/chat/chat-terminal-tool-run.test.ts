import { describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { ChevronRightIcon } from '@lucide/vue'
import ChatTerminalToolRun from '@/components/chat/ChatTerminalToolRun.vue'
import {
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from '@/components/ai-elements/terminal'
import {
  Collapsible,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import type { ToolRun } from '@/types/harness/tool-run'

vi.mock('vue-router', () => ({
  useRoute: () => ({
    name: 'project-chat',
    params: { slug: 'proj' },
  }),
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    projects: {
      value: [{ id: 'proj-1', slug: 'proj' }],
    },
    activeProjectId: { value: 'proj-1' },
  }),
}))

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    openAgentShell: vi.fn<() => void>(),
  }),
}))

const run: ToolRun = {
  toolCallId: 'tc-npm-audit',
  name: 'run_terminal',
  status: 'done',
  args: {
    command: 'npm audit',
    description: 'Run npm audit',
  },
  result: {
    command: 'npm audit',
    stdout: 'found 0 vulnerabilities',
    sandboxed: true,
    exitCode: 0,
    shellId: 'shell-1',
  },
}

const mountRun = () =>
  shallowMount(ChatTerminalToolRun, {
    props: { run },
    global: {
      renderStubDefaultSlot: true,
    },
  })

const trigger = (wrapper: ReturnType<typeof mountRun>) => {
  const byRef = wrapper.findAllComponents(CollapsibleTrigger)
  if (byRef.length > 0) {
    return byRef[0]
  }
  return wrapper.findAllComponents({ name: 'CollapsibleTrigger' })[0]
}

describe('ChatTerminalToolRun layout', () => {
  it('keeps the trigger row visible when open', async () => {
    const wrapper = mountRun()
    const collapsible = wrapper.findComponent(Collapsible)
    await collapsible.vm.$emit('update:open', true)

    expect(trigger(wrapper)?.exists()).toBe(true)
    expect(wrapper.findComponent(ChevronRightIcon).classes()).toContain('rotate-90')
  })

  it('does not render TerminalHeader or TerminalTitle', () => {
    const wrapper = mountRun()
    expect(wrapper.findComponent(TerminalHeader).exists()).toBe(false)
    expect(wrapper.findComponent(TerminalTitle).exists()).toBe(false)
    expect(wrapper.html()).not.toMatch(/TerminalHeader/i)
    expect(wrapper.html()).not.toMatch(/TerminalTitle/i)
  })

  it('renders TerminalCopyButton in the card', () => {
    const wrapper = mountRun()
    expect(wrapper.findComponent(TerminalCopyButton).exists()).toBe(true)
  })
})
