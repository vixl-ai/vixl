import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { FleetProject } from '@/types/fleet/fleet-project'

const resolveAgentDefinition = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<null>>(),
)
const getPlanExecutionSession = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => { subagentModel: string | null }>(),
)
const registerSubagent = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const resolveSubagent = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const emitSubagentResult = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const finishSubagentWithError = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => void>(),
)
const resolveSpawnModel = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string>>(),
)
const runSubagentGenerate = vi.hoisted(() =>
  vi.fn<
    (...args: unknown[]) => Promise<{ text: string; finishReason?: string }>
  >(),
)
const linkAbortSignal = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const getFleetProjects = vi.hoisted(() => vi.fn<() => FleetProject[]>())
const ensureFleetLoaded = vi.hoisted(() =>
  vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
)
const refreshFleetProjects = vi.hoisted(() =>
  vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/services/agents/resolve-agent-definition', () => ({
  default: (...args: unknown[]) => resolveAgentDefinition(...args),
}))

vi.mock('@/services/harness/plan-execution-session', () => ({
  getPlanExecutionSession: (...args: unknown[]) =>
    getPlanExecutionSession(...args),
}))

vi.mock('@/services/harness/subagent/registry', () => ({
  register: (...args: unknown[]) => registerSubagent(...args),
  resolve: (...args: unknown[]) => resolveSubagent(...args),
}))

vi.mock('@/services/harness/subagent/helpers', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/services/harness/subagent/helpers')
  >()
  return {
    ...actual,
    emitSubagentResult: (...args: unknown[]) => emitSubagentResult(...args),
    finishSubagentWithError: (...args: unknown[]) =>
      finishSubagentWithError(...args),
  }
})

vi.mock('@/services/harness/subagent/resolve-spawn-model', () => ({
  default: (...args: unknown[]) => resolveSpawnModel(...args),
}))

vi.mock('@/services/harness/subagent/run-generate', () => ({
  default: (...args: unknown[]) => runSubagentGenerate(...args),
}))

vi.mock('@/utils/link-abort-signal', () => ({
  default: (...args: unknown[]) => linkAbortSignal(...args),
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  getFleetProjects: () => getFleetProjects(),
  ensureFleetLoaded: () => ensureFleetLoaded(),
  refreshFleetProjects: () => refreshFleetProjects(),
}))

import spawnSubagent from '@/services/harness/subagent/spawn'

const parentProject: FleetProject = {
  id: 'proj-parent',
  name: 'demo',
  slug: 'demo',
  rootPath: '/tmp/project',
  lastOpened: '2026-01-01T00:00:00.000Z',
}

const worktreeChild: FleetProject = {
  id: 'proj-wt',
  name: 'feature',
  slug: 'feature',
  rootPath: '/tmp/worktrees/demo/feature',
  lastOpened: '2026-01-01T00:00:00.000Z',
  worktree: {
    parentId: 'proj-parent',
    branch: 'vixl/feature',
    managed: true,
  },
}

const worktreeSibling: FleetProject = {
  id: 'proj-wt-b',
  name: 'review',
  slug: 'review',
  rootPath: '/tmp/worktrees/demo/review',
  lastOpened: '2026-01-01T00:00:00.000Z',
  worktree: {
    parentId: 'proj-parent',
    branch: 'vixl/review',
    managed: true,
  },
}

const unrelatedProject: FleetProject = {
  id: 'proj-other',
  name: 'other',
  slug: 'other',
  rootPath: '/tmp/other',
  lastOpened: '2026-01-01T00:00:00.000Z',
}

const webMember: FleetProject = {
  id: 'proj-web',
  name: 'web',
  slug: 'web',
  rootPath: '/tmp/web',
  lastOpened: '2026-01-01T00:00:00.000Z',
}

const baseCtx = (overrides?: Partial<HarnessToolContext>): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'demo',
  chatId: 'chat-1',
  mode: 'agent',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
  onHarnessEvent: () => {},
  ...overrides,
})

const execute = async (
  ctx: HarnessToolContext,
  workspaceSlug?: string,
): Promise<unknown> => {
  const built = spawnSubagent(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  const input: Record<string, unknown> = {
    agentName: 'Implement auth',
    prompt: 'Implement the change.',
    mode: 'blocking',
    capabilities: 'write',
  }
  if (workspaceSlug !== undefined) {
    input.workspaceSlug = workspaceSlug
  }
  return runner(input, { toolCallId: 'call-1' })
}

describe('spawn_subagent workspaceSlug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveAgentDefinition.mockResolvedValue(null)
    getPlanExecutionSession.mockReturnValue({ subagentModel: null })
    resolveSpawnModel.mockResolvedValue('anthropic::claude-sonnet-4')
    runSubagentGenerate.mockResolvedValue({
      text: 'ok summary',
      finishReason: 'stop',
    })
    getFleetProjects.mockReturnValue([
      parentProject,
      worktreeChild,
      worktreeSibling,
      unrelatedProject,
      webMember,
    ])
    refreshFleetProjects.mockResolvedValue(undefined)
  })

  it('rejects an unknown slug after one refresh retry', async () => {
    await expect(execute(baseCtx(), 'missing')).rejects.toThrow(
      'Unknown workspace slug: missing',
    )
    expect(refreshFleetProjects).toHaveBeenCalledTimes(1)
    expect(runSubagentGenerate).not.toHaveBeenCalled()
  })

  it('refreshes once and accepts a slug that appears after reload', async () => {
    getFleetProjects
      .mockReturnValueOnce([parentProject])
      .mockReturnValueOnce([parentProject, worktreeChild])
    await expect(execute(baseCtx(), 'feature')).resolves.toMatchObject({
      summary: 'ok summary',
    })
    expect(refreshFleetProjects).toHaveBeenCalledTimes(1)
    expect(runSubagentGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: {
          projectRoot: '/tmp/worktrees/demo/feature',
          projectSlug: 'feature',
        },
      }),
    )
  })

  it('rejects an unrelated project slug', async () => {
    await expect(execute(baseCtx(), 'other')).rejects.toThrow(
      'workspaceSlug other is not a worktree of this project or a member of the current group',
    )
    expect(runSubagentGenerate).not.toHaveBeenCalled()
  })

  it('accepts a worktree child and passes the nested workspace', async () => {
    await expect(execute(baseCtx(), 'feature')).resolves.toMatchObject({
      summary: 'ok summary',
    })
    expect(runSubagentGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: {
          projectRoot: '/tmp/worktrees/demo/feature',
          projectSlug: 'feature',
        },
      }),
    )
  })

  it('accepts a sibling worktree when the chat is already on a child', async () => {
    const ctx = baseCtx({
      projectRoot: worktreeChild.rootPath,
      projectSlug: worktreeChild.slug,
    })
    await expect(execute(ctx, 'review')).resolves.toMatchObject({
      summary: 'ok summary',
    })
    expect(runSubagentGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: {
          projectRoot: '/tmp/worktrees/demo/review',
          projectSlug: 'review',
        },
      }),
    )
  })

  it('rejects the main checkout as a target when the chat is on a child', async () => {
    const ctx = baseCtx({
      projectRoot: worktreeChild.rootPath,
      projectSlug: worktreeChild.slug,
    })
    await expect(execute(ctx, 'demo')).rejects.toThrow(
      'workspaceSlug demo is not a worktree of this project or a member of the current group',
    )
    expect(runSubagentGenerate).not.toHaveBeenCalled()
  })

  it('rejects an unrelated project when the chat is on a child', async () => {
    const ctx = baseCtx({
      projectRoot: worktreeChild.rootPath,
      projectSlug: worktreeChild.slug,
    })
    await expect(execute(ctx, 'other')).rejects.toThrow(
      'workspaceSlug other is not a worktree of this project or a member of the current group',
    )
    expect(runSubagentGenerate).not.toHaveBeenCalled()
  })

  it('accepts a group member when members are set', async () => {
    const ctx = baseCtx({
      members: [
        { slug: 'demo', name: 'Demo', rootPath: '/tmp/project' },
        { slug: 'web', name: 'Web', rootPath: '/tmp/web' },
      ],
    })
    await expect(execute(ctx, 'web')).resolves.toMatchObject({
      summary: 'ok summary',
    })
    expect(runSubagentGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: {
          projectRoot: '/tmp/web',
          projectSlug: 'web',
        },
      }),
    )
  })
})
