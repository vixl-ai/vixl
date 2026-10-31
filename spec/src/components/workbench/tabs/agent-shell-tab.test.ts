import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import AgentShellTab from '@/components/workbench/tabs/AgentShellTab.vue'
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import { Terminal } from '@/components/ai-elements/terminal'
import { agentShellRevision } from '@/services/harness/shell/registry'
import { mockTauriEvent } from '../../../test-utils/mocks/tauri-event'
import type { AgentShellRecord } from '@/types/harness/agent-shell'
import type { WorkbenchTab } from '@/types/workbench/workbench-tab'

const getAgentShell = vi.hoisted(() => vi.fn<(shellId: string) => AgentShellRecord | null>())
const killAgentShell = vi.hoisted(
  () => vi.fn<(shellId: string) => Promise<AgentShellRecord>>(),
)

vi.mock('@tauri-apps/api/event', () => mockTauriEvent())

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/composables/use-transparency', () => ({
  default: () => ({
    transparencyEnabled: { value: false },
  }),
}))

vi.mock('@/services/harness/shell/registry', async () => {
  const { ref } = await import('vue')
  return {
    getAgentShell: (shellId: string) => getAgentShell(shellId),
    killAgentShell: (shellId: string) => killAgentShell(shellId),
    agentShellRevision: ref(0),
  }
})

const tab: WorkbenchTab = {
  id: 'tab-shell-1',
  type: 'agent-shell',
  projectId: 'proj-1',
  label: 'Agent shell',
  payload: { shellId: 'shell-1' },
}

const record = (partial: Partial<AgentShellRecord> = {}): AgentShellRecord => ({
  shellId: 'shell-1',
  chatId: 'chat-1',
  projectRoot: '/tmp/proj',
  command: 'for i in 1 2 3; do echo tick; done',
  description: 'Background 30s poll loop',
  status: 'running',
  stdout: 'tick 1\n',
  stderr: '',
  exitCode: null,
  exitSignal: null,
  startedAt: '2026-01-01T00:00:00.000Z',
  background: true,
  wakeParent: false,
  ...partial,
})

const mountTab = (shell: AgentShellRecord) => {
  getAgentShell.mockReturnValue(shell)
  return shallowMount(AgentShellTab, {
    props: { tab },
    global: {
      renderStubDefaultSlot: true,
    },
  })
}

describe('AgentShellTab header', () => {
  it('shows the command with stop and shimmer while the shell is running', () => {
    const wrapper = mountTab(record())
    expect(wrapper.text()).toContain('for i in 1 2 3; do echo tick; done')
    expect(wrapper.text()).not.toContain('Background 30s poll loop')
    expect(wrapper.text()).not.toContain('Running')
    expect(wrapper.find('[aria-label="Stop terminal"]').exists()).toBe(true)
    expect(wrapper.findComponent(AiElementsShimmerShimmer).exists()).toBe(true)
    expect(wrapper.findComponent(Terminal).props('isStreaming')).toBe(true)
  })

  it('drops stop and shimmer after the shell exits, without an exit label', () => {
    const wrapper = mountTab(record({ status: 'completed', exitCode: 0, stdout: 'tick 1\n' }))
    expect(wrapper.text()).toContain('for i in 1 2 3; do echo tick; done')
    expect(wrapper.text()).not.toContain('Exit')
    expect(wrapper.text()).not.toContain('Running')
    expect(wrapper.find('[aria-label="Stop terminal"]').exists()).toBe(false)
    expect(wrapper.findComponent(AiElementsShimmerShimmer).exists()).toBe(false)
    expect(wrapper.findComponent(Terminal).props('isStreaming')).toBe(false)
  })

  it('repaints when the same shell record stops', async () => {
    const shell = record()
    const wrapper = mountTab(shell)
    const terminal = () => wrapper.findComponent(Terminal)
    expect(wrapper.find('[aria-label="Stop terminal"]').exists()).toBe(true)
    expect(terminal().props('output')).toContain('tick 1')

    shell.status = 'failed'
    shell.exitCode = 1
    shell.stdout = 'tick 1\ntick 2\n'
    agentShellRevision.value += 1
    await nextTick()

    expect(terminal().props('output')).toContain('tick 2')
    expect(wrapper.text()).not.toContain('Exit')
    expect(wrapper.text()).not.toContain('Running')
    expect(wrapper.find('[aria-label="Stop terminal"]').exists()).toBe(false)
    expect(wrapper.findComponent(AiElementsShimmerShimmer).exists()).toBe(false)
    expect(wrapper.findComponent(Terminal).props('isStreaming')).toBe(false)
  })
})
