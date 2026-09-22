import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { HOME_CHAT_SLUG, HOME_WORKSPACE_ID } from '@/constants/home-chat'
import { parsedPlanSchema } from '@/schemas/plan-document'
import createPlan from '@/services/plans/write-plan'
import parsePlan from '@/services/plans/parse-plan'
import {
  dropPlanExecutionSession,
  markCreatedPlanThisTurn,
  setActivePlanPath,
} from '@/services/harness/plan-execution-session'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const fsWriteFile = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({})
const fsReadFile = vi.fn<(...args: unknown[]) => Promise<{ content: string }>>()
const openPlan = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
const ensureHomeRoot = vi.fn<() => Promise<string>>().mockResolvedValue('/Users/test-home')
const resolveProjectIdByRoot = vi.fn<(root: string) => string | null>(() => 'project-1')
const refreshPlanTabs = vi.fn<() => void>()

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsWriteFile,
    fsReadFile,
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
const chatId = 'chat-update-plan'
const projectRoot = '/tmp/project'
const awaitingPlanPath = '.vixl/plans/awaiting/PLAN.md'
const activePlanPath = '.vixl/plans/bound/PLAN.md'
const explicitPlanPath = '.vixl/plans/explicit/PLAN.md'
const replacementBody = '## Summary\n\nRevised plan body.\n'

const planCtx = (overrides?: Partial<HarnessToolContext>): HarnessToolContext => ({
  projectRoot,
  projectSlug,
  chatId,
  mode: 'agent',
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
  return runner(input, { toolCallId: 'tc-update-plan' })
}

const writtenCall = () =>
  fsWriteFile.mock.calls[0]?.[0] as {
    projectRoot: string
    path: string
    content: string
  }

const existingPlan = createPlan({
  title: 'Merge plan',
  body: '## Goal\n\nShip it.\n',
  todos: [
    { id: 'keep', content: 'Keep me', status: 'in_progress' },
    { id: 'update', content: 'Old text', status: 'pending' },
  ],
})

describe('update_plan', () => {
  beforeEach(() => {
    dropPlanExecutionSession(projectSlug, chatId)
    dropPlanExecutionSession(HOME_CHAT_SLUG, 'home-chat-update-plan')
    openPlan.mockClear()
    ensureHomeRoot.mockClear()
    resolveProjectIdByRoot.mockClear()
    refreshPlanTabs.mockClear()
    fsWriteFile.mockClear()
    fsReadFile.mockReset()
    fsReadFile.mockResolvedValue({ content: existingPlan.content })
  })

  it('resolves omitted planPath via awaitingPlanGo before session.activePlanPath', async () => {
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath: awaitingPlanPath,
      planId: 'awaiting',
    })
    setActivePlanPath(projectSlug, chatId, activePlanPath)
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(planCtx())

    const result = (await runTool(tool.execute, {
      body: replacementBody,
    })) as { planPath: string; title: string }

    expect(result.planPath).toBe(awaitingPlanPath)
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot,
      path: awaitingPlanPath,
    })
    expect(writtenCall().path).toBe(awaitingPlanPath)
  })

  it('resolves omitted planPath via session.activePlanPath when awaitingPlanGo is absent', async () => {
    setActivePlanPath(projectSlug, chatId, existingPlan.path)
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(planCtx())

    const result = (await runTool(tool.execute, {
      body: replacementBody,
    })) as { planPath: string; title: string }

    expect(result.planPath).toBe(existingPlan.path)
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot,
      path: existingPlan.path,
    })
    expect(fsWriteFile).toHaveBeenCalled()
  })

  it('prefers an explicit planPath over session state', async () => {
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath: awaitingPlanPath,
      planId: 'awaiting',
    })
    setActivePlanPath(projectSlug, chatId, activePlanPath)
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(planCtx())

    const result = (await runTool(tool.execute, {
      planPath: explicitPlanPath,
      body: replacementBody,
    })) as { planPath: string; title: string }

    expect(result.planPath).toBe(explicitPlanPath)
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot,
      path: explicitPlanPath,
    })
    expect(writtenCall().path).toBe(explicitPlanPath)
  })

  it('returns an error object when no plan resolves and does not write', async () => {
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(planCtx())

    const result = await runTool(tool.execute, { body: replacementBody })

    expect(result).toEqual({
      error: 'No active plan was found. Pass planPath, or create a plan first.',
    })
    expect(fsReadFile).not.toHaveBeenCalled()
    expect(fsWriteFile).not.toHaveBeenCalled()
  })

  it('replaces the body while preserving frontmatter id, createdAt, mode, and todos', async () => {
    const original = parsePlan(existingPlan.content)
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(planCtx())

    const result = (await runTool(tool.execute, {
      planPath: existingPlan.path,
      body: replacementBody,
    })) as { planPath: string; title: string }

    expect(result).toEqual({ planPath: existingPlan.path, title: 'Merge plan' })
    expect(fsWriteFile).toHaveBeenCalledTimes(1)
    const written = writtenCall()
    expect(written.projectRoot).toBe(projectRoot)
    expect(written.path).toBe(existingPlan.path)
    const parsed = parsePlan(written.content)
    expect(parsed.parseError).toBeUndefined()
    expect(parsed.body).toBe(replacementBody.trim())
    expect(parsed.frontmatter?.id).toBe(original.frontmatter?.id)
    expect(parsed.frontmatter?.createdAt).toBe(original.frontmatter?.createdAt)
    expect(parsed.frontmatter?.mode).toBe('plan')
    expect(parsed.frontmatter?.todos).toEqual(original.frontmatter?.todos)
    expect(parsed.frontmatter?.title).toBe('Merge plan')
    expect(openPlan).toHaveBeenCalledWith(
      'project-1',
      existingPlan.planId,
      existingPlan.path,
      'Merge plan',
    )
    expect(refreshPlanTabs).toHaveBeenCalled()
    expect(ensureHomeRoot).not.toHaveBeenCalled()
  })

  it('updates the frontmatter title when title is provided', async () => {
    const original = parsePlan(existingPlan.content)
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(planCtx())

    const result = (await runTool(tool.execute, {
      planPath: existingPlan.path,
      body: replacementBody,
      title: 'Revised title',
    })) as { planPath: string; title: string }

    expect(result).toEqual({ planPath: existingPlan.path, title: 'Revised title' })
    const parsed = parsePlan(writtenCall().content)
    expect(parsed.parseError).toBeUndefined()
    expect(parsed.frontmatter?.title).toBe('Revised title')
    expect(parsed.frontmatter?.id).toBe(original.frontmatter?.id)
    expect(parsed.frontmatter?.todos).toEqual(original.frontmatter?.todos)
    expect(parsed.body).toBe(replacementBody.trim())
    expect(openPlan).toHaveBeenCalledWith(
      'project-1',
      existingPlan.planId,
      existingPlan.path,
      'Revised title',
    )
  })

  it('keeps the existing title when title is omitted', async () => {
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(planCtx())

    const result = (await runTool(tool.execute, {
      planPath: existingPlan.path,
      body: replacementBody,
    })) as { planPath: string; title: string }

    expect(result.title).toBe('Merge plan')
    const parsed = parsePlan(writtenCall().content)
    expect(parsed.frontmatter?.title).toBe('Merge plan')
  })

  it('throws when the replacement body fails parsedPlanSchema validation and does not write', async () => {
    const spy = vi.spyOn(parsedPlanSchema, 'safeParse').mockReturnValue({
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['body'],
          message: 'Invalid',
        },
      ]),
    })
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(planCtx())

    try {
      await expect(
        runTool(tool.execute, {
          planPath: existingPlan.path,
          body: replacementBody,
        }),
      ).rejects.toThrow(/Invalid plan document/)
      expect(fsWriteFile).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('throws when the existing file is unparseable and does not write', async () => {
    fsReadFile.mockResolvedValue({ content: 'not a plan file' })
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(planCtx())

    await expect(
      runTool(tool.execute, {
        planPath: existingPlan.path,
        body: replacementBody,
      }),
    ).rejects.toThrow('Plan file is missing YAML frontmatter (expected --- delimiters).')
    expect(fsWriteFile).not.toHaveBeenCalled()
  })

  it('opens the plan tab with HOME_WORKSPACE_ID for a home-chat slug', async () => {
    const homeChatId = 'home-chat-update-plan'
    const updatePlan = (await import('@/services/harness/plan/update')).default
    const tool = updatePlan(
      planCtx({
        projectRoot: '/Users/test-home',
        projectSlug: HOME_CHAT_SLUG,
        chatId: homeChatId,
      }),
    )

    await runTool(tool.execute, {
      planPath: existingPlan.path,
      body: replacementBody,
    })

    expect(ensureHomeRoot).toHaveBeenCalled()
    expect(resolveProjectIdByRoot).not.toHaveBeenCalled()
    expect(openPlan).toHaveBeenCalledWith(
      HOME_WORKSPACE_ID,
      existingPlan.planId,
      existingPlan.path,
      'Merge plan',
    )
    expect(refreshPlanTabs).toHaveBeenCalled()
  })
})
