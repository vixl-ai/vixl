import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { shallowMount, type VueWrapper } from '@vue/test-utils'

vi.hoisted(() => {
  Object.defineProperty(document, 'queryCommandSupported', {
    configurable: true,
    value: () => false,
  })
})

const viewState = vi.hoisted(() => ({
  isSubagentView: true,
}))

vi.mock('@/components/chat/ChatPromptInput.vue', () => ({
  default: {
    name: 'ChatPromptInput',
    props: [
      'status',
      'disabled',
      'permissionLevel',
      'waitingOnBackground',
      'allowSubmitWhileBusy',
      'hideModel',
      'hideStop',
    ],
    template: '<div data-testid="chat-prompt-input" />',
  },
}))

vi.mock('@/composables/agent-thread-view', () => ({
  default: () => ({
    workbench: { rightSidebarOpen: computed(() => false) },
    contextActions: { available: computed(() => false) },
    mcpPersonalConfig: ref(null),
    mcpProjectConfig: ref(null),
    threadReady: ref(true),
    projectSlug: computed(() => 'proj'),
    chatId: computed(() => 'chat-1'),
    isSubagentView: computed(() => viewState.isSubagentView),
    threadKey: computed(() => 'proj:chat-1'),
    harnessStatus: computed(() => 'streaming'),
    harnessPendingApprovals: computed(() => [
      {
        toolCallId: 'tc-1',
        name: 'write',
        kind: 'fs',
        title: 'Write',
        allowedScopes: [],
      },
    ]),
    harnessPendingMcpAuth: computed(() => []),
    queuedMessages: computed(() => []),
    isWaitingOnBackground: computed(() => false),
    runningSubagents: computed(() => []),
    chatPromptInputRef: ref(null),
    pendingQuestion: computed(() => ({
      toolCallId: 'q-1',
      question: 'Which file?',
      options: [],
    })),
    compacting: computed(() => false),
    timeline: computed(() => []),
    todos: computed(() => [{ id: 't1', content: 'todo', status: 'pending' }]),
    runningShells: computed(() => []),
    activePermissionLevel: computed(() => 'ask'),
    filePolicyOpen: ref(false),
    filePolicyChanges: ref([]),
    filePolicyTitle: ref(''),
    filePolicyEmphasizeRevert: ref(false),
    handleSubmit: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handleSubmitEdit: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handleFilePolicyKeep: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handleFilePolicyRevert: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handleRestoreFiles: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handleStop: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handleStopSubagent: vi.fn<(id: string) => void>(),
    handleOpenSubagent: vi.fn<(id: string) => Promise<void>>(),
    handleQueueForce: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handleQueueRemove: vi.fn<(id: string) => void>(),
    handleQueueEdit: vi.fn<(id: string) => Promise<void>>(),
    handleKillShell: vi.fn<(id: string) => Promise<void>>(),
    handleOpenShell: vi.fn<(id: string) => void>(),
    handleResolveApproval: vi.fn<(...args: unknown[]) => void>(),
    handleSubmitAnswer: vi.fn<(...args: unknown[]) => void>(),
    handleAuthenticateMcp: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handleSecretsSavedMcp: vi.fn<(id: string) => Promise<void>>(),
    handleSkipMcpAuth: vi.fn<(id: string) => void>(),
    handleOpenMcpSettings: vi.fn<() => Promise<void>>(),
    handleRetry: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handleContinue: vi.fn<(...args: unknown[]) => Promise<void>>(),
    handlePermissionLevelChange: vi.fn<(...args: unknown[]) => Promise<void>>(),
    continuableTurnId: computed(() => null),
  }),
}))

import AgentThreadView from '@/views/AgentThreadView.vue'

const panelMenuStub = {
  name: 'ChatChatPanelContextMenu',
  template: '<div data-testid="panel-context-menu"><slot /></div>',
}

const mountView = () =>
  shallowMount(AgentThreadView, {
    global: {
      stubs: {
        ChatChatPanelContextMenu: panelMenuStub,
      },
    },
  })

const expectPromptOutsidePanelMenu = (wrapper: VueWrapper): void => {
  const panelMenu = wrapper.findComponent({ name: 'ChatChatPanelContextMenu' })
  expect(wrapper.findComponent({ name: 'ChatPromptInput' }).exists()).toBe(true)
  expect(panelMenu.exists()).toBe(true)
  expect(panelMenu.find('[data-testid="panel-context-menu"]').exists()).toBe(true)
  expect(panelMenu.findComponent({ name: 'ChatPromptInput' }).exists()).toBe(false)
  expect(panelMenu.findComponent({ name: 'ChatThread' }).exists()).toBe(true)
}

describe('AgentThreadView subagent composer', () => {
  it('renders ChatPromptInput in the subagent view without approvals chrome', () => {
    viewState.isSubagentView = true
    const wrapper = mountView()

    const prompt = wrapper.findComponent({ name: 'ChatPromptInput' })
    expect(prompt.exists()).toBe(true)
    expect(prompt.props('allowSubmitWhileBusy')).toBe(true)
    expect(prompt.props('waitingOnBackground')).toBe(false)
    expect(wrapper.findComponent({ name: 'ChatPendingApprovals' }).exists()).toBe(
      false,
    )
    expect(wrapper.findComponent({ name: 'ChatTodoTimeline' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ChatMessageQueue' }).exists()).toBe(false)
    expectPromptOutsidePanelMenu(wrapper)
    wrapper.unmount()
  })

  it('renders parent composer chrome when not in the subagent view', () => {
    viewState.isSubagentView = false
    const wrapper = mountView()

    expect(wrapper.findComponent({ name: 'ChatPromptInput' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ChatPendingApprovals' }).exists()).toBe(
      true,
    )
    expect(wrapper.findComponent({ name: 'ChatStackPillBar' }).exists()).toBe(true)
    expectPromptOutsidePanelMenu(wrapper)
    wrapper.unmount()
  })

  it('passes hideModel and hideStop to ChatPromptInput in the subagent view', () => {
    viewState.isSubagentView = true
    const wrapper = mountView()

    const prompt = wrapper.findComponent({ name: 'ChatPromptInput' })
    expect(prompt.exists()).toBe(true)
    expect(prompt.props('hideModel')).toBe(true)
    expect(prompt.props('hideStop')).toBe(true)
    wrapper.unmount()
  })

  it('passes hideModel false and hideStop false in the parent view', () => {
    viewState.isSubagentView = false
    const wrapper = mountView()

    const prompt = wrapper.findComponent({ name: 'ChatPromptInput' })
    expect(prompt.exists()).toBe(true)
    expect(prompt.props('hideModel')).toBe(false)
    expect(prompt.props('hideStop')).toBe(false)
    wrapper.unmount()
  })
})
