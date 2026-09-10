import { describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { ChevronRightIcon } from '@lucide/vue'
import ChatTerminalToolRun from '@/components/chat/ChatTerminalToolRun.vue'
import ChatTipIcon from '@/components/chat/ChatTipIcon.vue'
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

const retryRun: ToolRun = {
  toolCallId: 'tc-ls-disk',
  name: 'run_terminal',
  status: 'done',
  args: {
    command: 'ls /dev/disk',
  },
  result: {
    command: 'ls /dev/disk',
    stdout: 'disk0',
    sandboxed: false,
    exitCode: 0,
    shellId: 'shell-2',
    priorPhase: {
      sandboxed: true,
      stdout: '',
      error: 'Sandbox blocked: isolated devices',
      exitCode: 1,
    },
  },
}

const mountRun = (toolRun: ToolRun = run) =>
  shallowMount(ChatTerminalToolRun, {
    props: { run: toolRun },
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

  it('shows only the final phase sandbox badge in the header', () => {
    const wrapper = mountRun(retryRun)
    const tips = wrapper.findAllComponents(ChatTipIcon)
    const sandboxTips = tips.filter((tip) => {
      const tooltip = tip.props('tooltip')
      return tooltip === 'Sandboxed' || tooltip === 'Unsandboxed'
    })
    expect(sandboxTips).toHaveLength(1)
    expect(sandboxTips[0]?.props('tooltip')).toBe('Unsandboxed')
  })

  it('labels each terminal pane when a sandbox retry produced two phases', () => {
    const wrapper = mountRun(retryRun)
    const labels = wrapper.findAll('p').map((node) => node.text())
    expect(labels).toContain('Sandboxed')
    expect(labels).toContain('Unsandboxed')
  })

  it('omits phase labels when there is a single phase', () => {
    const wrapper = mountRun()
    const labels = wrapper.findAll('p').map((node) => node.text())
    expect(labels).not.toContain('Sandboxed')
    expect(labels).not.toContain('Unsandboxed')
  })
})
