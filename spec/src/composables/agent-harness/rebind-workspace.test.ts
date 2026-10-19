import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AgentHarnessState } from '@/composables/agent-harness/types'
import type { PlanPayload, WorkbenchTab } from '@/types/workbench/workbench-tab'

const routerReplace = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/router', () => ({
  default: {
    replace: (...args: unknown[]) => routerReplace(...args),
  },
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const rekeyAgentHarness = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('@/composables/agent-harness/cache', () => ({
  rekeyAgentHarness: (...args: unknown[]) => rekeyAgentHarness(...args),
}))

import rebindWorkspace from '@/composables/agent-harness/rebind-workspace'
import {
  dropPlanExecutionSession,
  setActivePlanPath,
} from '@/services/harness/plan-execution-session'

const workspaceMoved = {
  type: 'workspace-moved' as const,
  fromProjectSlug: '_home_',
  chatId: 'chat-1',
  project: {
    id: 'proj-1',
    name: 'Dest',
    slug: 'dest',
    rootPath: '/tmp/dest',
  },
  projectSlug: 'dest',
  projectRoot: '/tmp/dest',
}

const buildState = (): AgentHarnessState =>
  ({
    options: {
      projectSlug: '_home_',
      chatId: 'chat-1',
      projectRoot: '/home',
      projectName: 'Home',
      standalone: true,
    },
    fleet: {
      refresh: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      setActiveProject: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    },
    fleetSidebar: {
      refreshSlug: vi.fn<(slug: string) => Promise<void>>().mockResolvedValue(undefined),
    },
    chatStore: {
      rekeySession: vi.fn<(...args: unknown[]) => void>(),
    },
  }) as unknown as AgentHarnessState

describe('rebind-workspace plan tab', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { tabs, activeTabId } = await import('@/composables/workbench-store/state')
    tabs.value = []
    activeTabId.value = null
    dropPlanExecutionSession('_home_', 'chat-1')
    dropPlanExecutionSession('dest', 'chat-1')
  })

  afterEach(async () => {
    const { tabs, activeTabId } = await import('@/composables/workbench-store/state')
    tabs.value = []
    activeTabId.value = null
    dropPlanExecutionSession('_home_', 'chat-1')
    dropPlanExecutionSession('dest', 'chat-1')
  })

  it('rekeys the open workbench plan tab to the destination project', async () => {
    const { tabs } = await import('@/composables/workbench-store/state')
    setActivePlanPath('_home_', 'chat-1', '.vixl/plans/ship-it/PLAN.md')
    const tab: WorkbenchTab = {
      id: 'tab-1',
      type: 'plan',
      projectId: 'home-proj',
      label: 'Ship it',
      payload: {
        planId: 'ship-it',
        path: '.vixl/plans/ship-it/PLAN.md',
      } satisfies PlanPayload,
    }
    tabs.value = [tab]

    await rebindWorkspace(buildState(), workspaceMoved)

    expect(tabs.value[0]?.projectId).toBe('proj-1')
    expect(tabs.value[0]?.id).toBe('tab-1')
    expect(tabs.value[0]?.payload).toEqual({
      planId: 'ship-it',
      path: '.vixl/plans/ship-it/PLAN.md',
    })
  })

  it('leaves workbench tabs alone when no plan tab is open', async () => {
    const { tabs } = await import('@/composables/workbench-store/state')
    setActivePlanPath('_home_', 'chat-1', '.vixl/plans/ship-it/PLAN.md')
    const tab: WorkbenchTab = {
      id: 'tab-1',
      type: 'editor',
      projectId: 'home-proj',
      label: 'Editor',
      payload: { path: 'README.md', openPaths: ['README.md'] },
    }
    tabs.value = [tab]

    await rebindWorkspace(buildState(), workspaceMoved)

    expect(tabs.value[0]?.projectId).toBe('home-proj')
    expect(tabs.value[0]?.type).toBe('editor')
  })

  it('does nothing when the session has no active plan path', async () => {
    const { tabs } = await import('@/composables/workbench-store/state')
    const tab: WorkbenchTab = {
      id: 'tab-1',
      type: 'plan',
      projectId: 'home-proj',
      label: 'Ship it',
      payload: {
        planId: 'ship-it',
        path: '.vixl/plans/ship-it/PLAN.md',
      } satisfies PlanPayload,
    }
    tabs.value = [tab]

    await rebindWorkspace(buildState(), workspaceMoved)

    expect(tabs.value[0]?.projectId).toBe('home-proj')
  })

  it('updates loadedThreadKey after rekeying', async () => {
    const loadedThreadKey = ref<string | null>('_home_:chat-1')
    const state = {
      ...buildState(),
      options: {
        projectSlug: '_home_',
        chatId: 'chat-1',
        projectRoot: '/home',
        projectName: 'Home',
        standalone: true,
        loadedThreadKey,
      },
    } as unknown as AgentHarnessState

    await rebindWorkspace(state, workspaceMoved)

    expect(loadedThreadKey.value).toBe('dest:chat-1')
  })
})
