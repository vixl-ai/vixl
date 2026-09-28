import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef, type EffectScope } from 'vue'
import type { AgentHarnessState } from '@/composables/agent-harness/types'
import type { AgentThreadViewState } from '@/composables/agent-thread-view/types'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

vi.hoisted(() => {
  Object.defineProperty(document, 'queryCommandSupported', {
    configurable: true,
    value: () => false,
  })
})

const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
)
const killShellsForChat = vi.hoisted(() =>
  vi.fn<(chatId: string) => Promise<void>>().mockResolvedValue(undefined),
)

let capturedState: AgentThreadViewState | null = null

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    updateChatMeta: (...args: unknown[]) => updateChatMeta(...args),
  }),
)

vi.mock('@/services/harness/shell/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/harness/shell/registry')>()
  return {
    ...actual,
    killShellsForChat: (chatId: string) => killShellsForChat(chatId),
  }
})

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => ({
      name: 'project-chat',
      params: { slug: 'proj', chatId: 'chat-1' },
    }),
    useRouter: () => ({
      push: vi.fn<(to: unknown) => Promise<void>>(),
    }),
  }
})

vi.mock('@/composables/use-agent-harness', () => ({
  default: vi.fn<() => unknown>(),
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    projects: {
      value: [
        {
          id: 'proj-1',
          slug: 'proj',
          rootPath: '/tmp/proj',
          name: 'Proj',
        },
      ],
    },
    loaded: { value: true },
  }),
}))

vi.mock('@/composables/use-fleet-sidebar', () => ({
  default: () => ({
    refreshSlug: vi.fn<(slug: string) => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/composables/use-chat-store', () => ({
  default: () => ({
    meta: { value: { projectRoot: '/tmp/proj' } },
    forChat: () => ({
      timeline: { value: [] },
      todos: { value: [] },
      pendingQuestion: { value: null },
      getSubagent: () => null,
    }),
  }),
}))

vi.mock('@/composables/use-vixl-config', () => ({
  default: () => ({
    hydrated: { value: true },
    personalSettings: { value: { version: 1 } },
    effectiveSettings: { value: { version: 1 } },
  }),
}))

vi.mock('@/composables/use-mcp-servers', () => ({
  default: () => ({
    personalMcp: { value: null },
    projectMcp: { value: null },
  }),
}))

vi.mock('@/composables/use-chat-context-actions', () => ({
  default: () => ({
    register: vi.fn<() => void>(),
    setDisabled: vi.fn<() => void>(),
    clear: vi.fn<() => void>(),
    compacting: { value: false },
    available: { value: false },
  }),
}))

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    rightSidebarOpen: { value: false },
  }),
}))

vi.mock('@/composables/use-chat-context-budget-sync', () => ({
  default: () => ({
    draftMentions: { value: [] },
  }),
}))

vi.mock('@/composables/use-root-effective-settings', () => ({
  default: () => ({
    settings: { value: { 'agent.permissionLevel': 'allowlist' } },
    reload: vi.fn<() => Promise<void>>(),
  }),
}))

vi.mock('@/composables/agent-thread-view/lifecycle', () => ({
  bindAgentThreadLifecycle: vi.fn<() => void>(),
}))

vi.mock('@/composables/agent-thread-view/handlers', () => ({
  createHandlers: () => ({}),
}))

vi.mock('@/composables/agent-thread-view/session', () => ({
  createSessionOps: (state: AgentThreadViewState) => {
    capturedState = state
    return {
      loadThread: vi.fn<() => Promise<void>>(),
      flushPendingChatMessage: vi.fn<() => Promise<void>>(),
    }
  },
}))

import createHelpers from '@/composables/agent-harness/helpers'
import createLifecycle from '@/composables/agent-harness/lifecycle'
import useAgentThreadView from '@/composables/agent-thread-view/use-agent-thread-view'
import { resetApprovalGateForTests } from '@/services/harness/permission/approval-gate'
import {
  register,
  resetSubagentRegistryForTests,
  resolve,
} from '@/services/harness/subagent/registry'

const buildHarnessState = (): AgentHarnessState =>
  ({
    options: {
      projectSlug: 'proj',
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      projectName: 'proj',
      standalone: false,
    },
    session: {
      completeLocalSubagent: vi.fn<(...args: unknown[]) => void>(),
      clearLocalQueuedSubagentSteers: vi.fn<(id: string) => void>(),
      finishAgentTurn: vi.fn<() => void>(),
      patchMeta: vi.fn<(patch: unknown) => void>(),
      pendingQuestion: { value: null },
    },
    status: ref('ready'),
    subagents: shallowRef([
      {
        subagentId: 'sub-1',
        name: 'explorer',
        blocking: false,
        status: 'done',
        events: [],
      },
    ]),
    abortController: ref(null),
    pendingApprovals: shallowRef([]),
    pendingMcpAuth: shallowRef([]),
    messageQueue: {
      items: ref([]),
      remove: vi.fn<(id: string) => void>(),
      clear: vi.fn<() => void>(),
    },
    suppressQueueDrainAfterStop: ref(false),
    compacting: ref(false),
    resumingBackgroundBatch: ref(false),
    disposed: ref(false),
    fleetSidebar: {
      refreshSlug: vi.fn<(slug: string) => Promise<void>>().mockResolvedValue(undefined),
    },
    chatStore: {
      isSessionActive: () => true,
    },
  }) as unknown as AgentHarnessState

describe('useAgentThreadView waiting on background', () => {
  let scope: EffectScope

  beforeEach(() => {
    vi.clearAllMocks()
    capturedState = null
    resetApprovalGateForTests()
    resetSubagentRegistryForTests()
    updateChatMeta.mockResolvedValue(undefined)
    killShellsForChat.mockResolvedValue(undefined)
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
  })

  it('hides waiting after stop when pending resume is set and no subagents are running', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'done',
    })

    const harnessState = buildHarnessState()
    const attention = createHelpers(harnessState)
    const { stop } = createLifecycle(harnessState, attention, {
      send: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      stopMcpAuthPolling: vi.fn<() => void>(),
      syncPendingMcpAuth: vi.fn<() => void>(),
      maybeFlushBackgroundSubagentResume: vi.fn<() => void>(),
    })

    const view = scope.run(() => useAgentThreadView())
    if (!view || !capturedState) {
      throw new Error('useAgentThreadView did not return')
    }

    capturedState.harness.value = {
      subagents: harnessState.subagents,
      status: harnessState.status,
      pendingApprovals: harnessState.pendingApprovals,
      pendingMcpAuth: harnessState.pendingMcpAuth,
      queuedMessages: harnessState.messageQueue.items,
      compacting: harnessState.compacting,
      isWaitingOnBackground: attention.isWaitingOnBackground,
      stop,
    } as never
    await nextTick()

    expect(view.isWaitingOnBackground.value).toBe(true)

    const subagentsBefore = harnessState.subagents.value
    await stop()

    expect(harnessState.subagents.value).toBe(subagentsBefore)
    expect(view.isWaitingOnBackground.value).toBe(false)
  })
})
