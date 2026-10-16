import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dropPlanExecutionSession,
  getPlanExecutionSession,
} from '@/services/harness/plan-execution-session'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import resolveMemberPath from '@/services/harness/resolve-member-path'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const fsWriteFile = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({})
const fsReadFile = vi.fn<(...args: unknown[]) => Promise<{ content: string }>>()
const updateChatMeta = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({})
const openPlan = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
const ensureHomeRoot = vi.fn<() => Promise<string>>().mockResolvedValue('/Users/test-home')
const resolveProjectIdByRoot = vi.fn<(root: string) => string | null>(() => 'project-1')
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

const projectSlug = 'project'
const chatId = 'chat-create-plan'
const projectRoot = '/tmp/project'
const apiMember: HarnessWorkspaceMember = {
  slug: 'api',
  name: 'API',
  rootPath: '/tmp/api',
}
const webMember: HarnessWorkspaceMember = {
  slug: 'web',
  name: 'Web',
  rootPath: '/tmp/web',
}
const groupMembers = [apiMember, webMember]

const planCtx = (overrides?: Partial<HarnessToolContext>): HarnessToolContext => ({
  projectRoot,
  projectSlug,
  chatId,
  mode: 'plan',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set<string>(),
  sessionDenies: new Set<string>(),
  sandboxEnabled: false,
  supportsVision: false,
  onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
  ...overrides,
})

const runTool = async (
  execute: unknown,
  input: Record<string, unknown>,
): Promise<unknown> => {
  const runner = execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'tc-create-plan' })
}

const writtenCall = () =>
  fsWriteFile.mock.calls[0]?.[0] as {
    projectRoot: string
    path: string
    content: string
  }

describe('create_plan', () => {
  beforeEach(() => {
    dropPlanExecutionSession(projectSlug, chatId)
    openPlan.mockClear()
    ensureHomeRoot.mockClear()
    resolveProjectIdByRoot.mockClear()
    refreshPlanTabs.mockClear()
    fsWriteFile.mockClear()
    fsReadFile.mockReset()
    updateChatMeta.mockClear()
  })

  it('returns an absolute path plus relativePath and tracks the relative session path', async () => {
    const createPlanTool = (await import('@/services/harness/plan/create')).default
    const tool = createPlanTool(planCtx())

    const result = (await runTool(tool.execute, {
      title: 'Ship it',
      body: '## Goal\n\nShip it.\n',
      todos: [{ id: 'first', content: 'Start', status: 'pending' }],
    })) as { planId: string; path: string; relativePath: string; todos: unknown[] }

    expect(result.relativePath).toMatch(/^\.vixl\/plans\/.+\/PLAN\.md$/)
    expect(result.path).toBe(`${projectRoot}/${result.relativePath}`)
    expect(result.path.startsWith(projectRoot)).toBe(true)
    expect(writtenCall().projectRoot).toBe(projectRoot)
    expect(writtenCall().path).toBe(result.relativePath)
    expect(writtenCall().content).toContain(`sourceChatId: ${chatId}`)
    expect(writtenCall().content).toContain(`sourceChatSlug: ${projectSlug}`)
    expect(openPlan).toHaveBeenCalledWith(
      'project-1',
      result.planId,
      result.relativePath,
      'Ship it',
    )
    expect(updateChatMeta).toHaveBeenCalledWith(projectSlug, chatId, {
      activePlanPath: result.relativePath,
      awaitingPlanGo: null,
    })
    const session = getPlanExecutionSession(projectSlug, chatId)
    expect(session.activePlanPath).toBe(result.relativePath)
    expect(session.createdPlanThisTurn).toBe(true)
  })

  it('joins a relative plan path onto a windows project root', async () => {
    const windowsRoot = 'C:\\Users\\proj'
    const createPlanTool = (await import('@/services/harness/plan/create')).default
    const tool = createPlanTool(planCtx({ projectRoot: windowsRoot }))

    const result = (await runTool(tool.execute, {
      title: 'Windows plan',
      body: '## Goal\n\nShip it.\n',
    })) as { path: string; relativePath: string }

    expect(result.relativePath).toMatch(/^\.vixl\/plans\/.+\/PLAN\.md$/)
    expect(result.path).toBe(
      `${windowsRoot}\\${result.relativePath.replace(/\//g, '\\')}`,
    )
    expect(writtenCall().path).toBe(result.relativePath)
  })

  it('lets update_plan resolve the relative session path after create_plan', async () => {
    const createPlanTool = (await import('@/services/harness/plan/create')).default
    const created = (await runTool(createPlanTool(planCtx()).execute, {
      title: 'Follow-up plan',
      body: '## Goal\n\nFirst draft.\n',
    })) as { path: string; relativePath: string }
    fsReadFile.mockResolvedValue({ content: writtenCall().content })

    const updatePlan = (await import('@/services/harness/plan/update')).default
    const updated = (await runTool(updatePlan(planCtx()).execute, {
      body: '## Summary\n\nRevised body.\n',
    })) as { planPath: string; relativePath: string }

    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot,
      path: created.relativePath,
    })
    expect(updated.relativePath).toBe(created.relativePath)
    expect(updated.planPath).toBe(created.path)
    expect(updated.planPath).toBe(`${projectRoot}/${created.relativePath}`)
    const writeCalls = fsWriteFile.mock.calls.map(
      (call) => call[0] as { path: string },
    )
    expect(writeCalls[1]?.path).toBe(created.relativePath)
  })

  it('lets update_plan_todo round-trip the returned absolute path', async () => {
    const createPlanTool = (await import('@/services/harness/plan/create')).default
    const created = (await runTool(createPlanTool(planCtx()).execute, {
      title: 'Round trip',
      body: '## Goal\n\nFirst draft.\n',
      todos: [{ id: 'first', content: 'Start', status: 'pending' }],
    })) as { path: string; relativePath: string }
    fsReadFile.mockResolvedValue({ content: writtenCall().content })

    const updatePlanTodo = (await import('@/services/harness/plan/update-todo')).default
    const updated = (await runTool(updatePlanTodo(planCtx()).execute, {
      planPath: created.path,
      todos: [{ id: 'first', content: 'Start', status: 'in_progress' }],
    })) as { planPath: string; relativePath: string }

    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot,
      path: created.relativePath,
    })
    expect(updated.relativePath).toBe(created.relativePath)
    expect(updated.planPath).toBe(created.path)
    const writeCalls = fsWriteFile.mock.calls.map(
      (call) => call[0] as { path: string },
    )
    expect(writeCalls[1]?.path).toBe(created.relativePath)
  })

  it('returns a slug-prefixed relativePath in group mode that file tools accept', async () => {
    const createPlanTool = (await import('@/services/harness/plan/create')).default
    const ctx = planCtx({
      projectRoot: apiMember.rootPath,
      projectSlug: 'stack',
      members: groupMembers,
    })
    const tool = createPlanTool(ctx)

    const result = (await runTool(tool.execute, {
      title: 'Group plan',
      body: '## Goal\n\nShip it.\n',
    })) as { planId: string; path: string; relativePath: string }

    expect(result.relativePath).toMatch(/^api\/\.vixl\/plans\/.+\/PLAN\.md$/)
    const resolved = resolveMemberPath(groupMembers, result.relativePath)
    expect(resolved.memberSlug).toBe('api')
    expect(resolved.root).toBe(apiMember.rootPath)
    expect(result.path).toBe(`${apiMember.rootPath}/${resolved.relativePath}`)
    expect(result.relativePath).toBe(`api/${resolved.relativePath}`)
    expect(writtenCall().projectRoot).toBe(apiMember.rootPath)
    expect(writtenCall().path).toBe(resolved.relativePath)
    expect(openPlan).toHaveBeenCalledWith(
      'project-1',
      result.planId,
      resolved.relativePath,
      'Group plan',
    )
  })

  it('lets update_plan and update_plan_todo round-trip the group-mode relativePath', async () => {
    const groupCtx = planCtx({
      projectRoot: apiMember.rootPath,
      projectSlug: 'stack',
      members: groupMembers,
    })
    dropPlanExecutionSession('stack', chatId)
    const createPlanTool = (await import('@/services/harness/plan/create')).default
    const created = (await runTool(createPlanTool(groupCtx).execute, {
      title: 'Group round trip',
      body: '## Goal\n\nFirst draft.\n',
      todos: [{ id: 'first', content: 'Start', status: 'pending' }],
    })) as { path: string; relativePath: string }
    expect(created.relativePath.startsWith('api/')).toBe(true)
    fsReadFile.mockResolvedValue({ content: writtenCall().content })

    const updatePlan = (await import('@/services/harness/plan/update')).default
    const updated = (await runTool(updatePlan(groupCtx).execute, {
      planPath: created.relativePath,
      body: '## Summary\n\nRevised body.\n',
    })) as { planPath: string; relativePath: string }

    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot: apiMember.rootPath,
      path: created.relativePath.slice('api/'.length),
    })
    expect(updated.relativePath).toBe(created.relativePath)
    expect(updated.planPath).toBe(created.path)

    const updatePlanTodo = (await import('@/services/harness/plan/update-todo')).default
    const todoUpdated = (await runTool(updatePlanTodo(groupCtx).execute, {
      planPath: created.relativePath,
      todos: [{ id: 'first', content: 'Start', status: 'in_progress' }],
    })) as { planPath: string; relativePath: string }

    expect(todoUpdated.relativePath).toBe(created.relativePath)
    expect(todoUpdated.planPath).toBe(created.path)
    const memberRelative = created.relativePath.slice('api/'.length)
    const writeCalls = fsWriteFile.mock.calls.map(
      (call) => call[0] as { projectRoot: string; path: string },
    )
    expect(writeCalls[0]?.path).toBe(memberRelative)
    expect(writeCalls[1]?.path).toBe(memberRelative)
    expect(writeCalls[1]?.projectRoot).toBe(apiMember.rootPath)
    expect(writeCalls[2]?.path).toBe(memberRelative)
    expect(writeCalls[2]?.projectRoot).toBe(apiMember.rootPath)
  })
})
