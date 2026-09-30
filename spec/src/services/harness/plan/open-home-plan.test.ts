import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HOME_CHAT_SLUG, HOME_WORKSPACE_ID } from '@/constants/home-chat'
import createPlan from '@/services/plans/write-plan'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const fsWriteFile = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({})
const fsReadFile = vi.fn<(...args: unknown[]) => Promise<{ content: string }>>()
const updateChatMeta = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({})
const openPlan = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
const ensureHomeRoot = vi.fn<() => Promise<string>>().mockResolvedValue('/Users/test-home')
const resolveProjectIdByRoot = vi.fn<(root: string) => string | null>(() => null)
const refreshPlanTabs = vi.fn<() => void>()

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsWriteFile,
    fsReadFile,
    updateChatMeta,
  }),
)

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    openPlan,
    ensureHomeRoot,
    resolveProjectIdByRoot,
    refreshPlanTabs,
  }),
}))

const homeCtx = (): HarnessToolContext => ({
  projectRoot: '/Users/test-home',
  projectSlug: HOME_CHAT_SLUG,
  chatId: 'home-chat-1',
  mode: 'plan',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set<string>(),
  sessionDenies: new Set<string>(),
  sandboxEnabled: false,
  supportsVision: false,
  onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
})

const runTool = async (
  execute: unknown,
  input: Record<string, unknown>,
): Promise<unknown> => {
  const runner = execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'tc-home-plan' })
}

describe('plan tools home workspace', () => {
  beforeEach(() => {
    openPlan.mockClear()
    ensureHomeRoot.mockClear()
    resolveProjectIdByRoot.mockClear()
    refreshPlanTabs.mockClear()
    fsWriteFile.mockClear()
    fsReadFile.mockReset()
    updateChatMeta.mockClear()
  })

  it('create_plan opens the plan tab with HOME_WORKSPACE_ID', async () => {
    const createPlanTool = (await import('@/services/harness/plan/create')).default
    const tool = createPlanTool(homeCtx())

    const result = (await runTool(tool.execute, {
      title: 'Home plan',
      body: '## Goal\n\nShip it.\n',
    })) as { planId: string; path: string }

    expect(ensureHomeRoot).toHaveBeenCalled()
    expect(resolveProjectIdByRoot).not.toHaveBeenCalled()
    expect(openPlan).toHaveBeenCalledWith(
      HOME_WORKSPACE_ID,
      result.planId,
      result.path,
      'Home plan',
    )
  })

  it('update_plan_todo opens the plan tab with HOME_WORKSPACE_ID', async () => {
    const created = createPlan({
      title: 'Home plan',
      body: '## Goal\n\nShip it.\n',
      todos: [{ id: 'first', content: 'Start', status: 'pending' }],
    })
    fsReadFile.mockResolvedValue({ content: created.content })

    const updatePlanTodo = (await import('@/services/harness/plan/update-todo')).default
    const tool = updatePlanTodo(homeCtx())

    await runTool(tool.execute, {
      planPath: created.path,
      todos: [{ id: 'first', content: 'Start', status: 'in_progress' }],
    })

    expect(ensureHomeRoot).toHaveBeenCalled()
    expect(resolveProjectIdByRoot).not.toHaveBeenCalled()
    expect(openPlan).toHaveBeenCalledWith(
      HOME_WORKSPACE_ID,
      created.planId,
      created.path,
      'Home plan',
    )
    expect(refreshPlanTabs).toHaveBeenCalled()
  })

  it('create_plan can create many plans in one chat, newest active', async () => {
    const { beginPlanExecutionTurn, dropPlanExecutionSession, getPlanExecutionSession } =
      await import('@/services/harness/plan-execution-session')
    dropPlanExecutionSession(HOME_CHAT_SLUG, 'home-chat-1')
    const createPlanTool = (await import('@/services/harness/plan/create')).default
    const tool = createPlanTool(homeCtx())

    const first = (await runTool(tool.execute, {
      title: 'Ticket one',
      body: '## Goal\n\nOne.\n',
    })) as { path: string }
    beginPlanExecutionTurn(HOME_CHAT_SLUG, 'home-chat-1')
    const second = (await runTool(tool.execute, {
      title: 'Ticket two',
      body: '## Goal\n\nTwo.\n',
    })) as { path: string }

    expect(second.path).not.toBe(first.path)
    const session = getPlanExecutionSession(HOME_CHAT_SLUG, 'home-chat-1')
    expect(session.activePlanPath).toBe(second.path)
    expect(session.createdPlanThisTurn).toBe(true)
    expect(updateChatMeta).toHaveBeenLastCalledWith(HOME_CHAT_SLUG, 'home-chat-1', {
      activePlanPath: second.path,
      awaitingPlanGo: null,
    })
  })
})
