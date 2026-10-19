import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessEvent } from '@/types/harness/harness-event'

const gateWorkspaceMovePermission = vi.hoisted(() =>
  vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
)

const gitWorktreeAdd = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

const gitWorktreeRemove = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

const registryAddProject = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

const moveChatToWorkspace = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

const ensureCodeGraph = vi.hoisted(() =>
  vi.fn<(root: string) => Promise<void>>().mockResolvedValue(undefined),
)

const refreshFleetProjects = vi.hoisted(() =>
  vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
)

const isHomeWorkspaceRoot = vi.hoisted(() =>
  vi.fn<(root: string) => Promise<boolean>>().mockResolvedValue(false),
)

vi.mock('@/services/harness/permission', () => ({
  gateWorkspaceMovePermission,
}))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  gitWorktreeAdd,
  gitWorktreeRemove,
  registryAddProject,
  moveChatToWorkspace,
}))

vi.mock('@/services/codegraph/ensure-codegraph', () => ({
  default: (root: string) => ensureCodeGraph(root),
}))

vi.mock('@/composables/use-fleet-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/use-fleet-registry')>()
  return {
    ...actual,
    refreshFleetProjects,
  }
})

vi.mock('@/services/config/is-home-workspace-root', () => ({
  isHomeWorkspaceRoot: (root: string) => isHomeWorkspaceRoot(root),
}))

import useFleetRegistry, { getFleetProjects } from '@/composables/use-fleet-registry'
import worktreeCreate from '@/services/harness/workspace/worktree-create'

const createdWorktree = {
  path: '/tmp/worktrees/demo/feature',
  branch: 'vixl/feature',
  name: 'feature',
}

const registeredProject = {
  id: 'proj-wt',
  name: 'feature',
  slug: 'feature',
  root_path: '/tmp/worktrees/demo/feature',
  last_opened: '2026-01-01T00:00:00.000Z',
}

const baseCtx = (): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
  onHarnessEvent: vi.fn<(event: HarnessEvent) => void | Promise<void>>(),
})

const execute = async (
  input: Record<string, unknown>,
  ctx: HarnessToolContext = baseCtx(),
): Promise<unknown> => {
  const built = worktreeCreate(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('worktree_create tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateWorkspaceMovePermission.mockResolvedValue(true)
    isHomeWorkspaceRoot.mockResolvedValue(false)
    gitWorktreeAdd.mockResolvedValue(createdWorktree)
    gitWorktreeRemove.mockResolvedValue(undefined)
    registryAddProject.mockResolvedValue(registeredProject)
    ensureCodeGraph.mockResolvedValue(undefined)
    refreshFleetProjects.mockResolvedValue(undefined)
    useFleetRegistry().projects.value = []
  })

  it('refuses on a subagent without prompting', async () => {
    const ctx = baseCtx()
    ctx.subagentId = 'sub-1'
    const result = await execute({ name: 'feature' }, ctx)

    expect(result).toEqual({
      error: 'worktree_create can only run on the parent chat',
    })
    expect(gateWorkspaceMovePermission).not.toHaveBeenCalled()
    expect(gitWorktreeAdd).not.toHaveBeenCalled()
    expect(registryAddProject).not.toHaveBeenCalled()
  })

  it('rejects a name that is not a lowercase slug', async () => {
    const result = await execute({ name: 'Feature' })

    expect(result).toEqual({
      error: 'Worktree name must be a lowercase slug (a-z, 0-9, hyphen)',
    })
    expect(gitWorktreeAdd).not.toHaveBeenCalled()
    expect(registryAddProject).not.toHaveBeenCalled()
  })

  it('registers the worktree and does not move the chat', async () => {
    const ctx = baseCtx()
    const result = await execute({ name: 'feature' }, ctx)

    expect(gitWorktreeAdd).toHaveBeenCalledWith('/tmp/project', 'feature', undefined)
    expect(registryAddProject).toHaveBeenCalledWith(
      'feature',
      '/tmp/worktrees/demo/feature',
    )
    expect(refreshFleetProjects).toHaveBeenCalledTimes(1)
    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/worktrees/demo/feature')
    expect(moveChatToWorkspace).not.toHaveBeenCalled()
    expect(ctx.projectRoot).toBe('/tmp/project')
    expect(ctx.projectSlug).toBe('project')
    expect(result).toEqual({
      ok: true,
      slug: 'feature',
      rootPath: '/tmp/worktrees/demo/feature',
      branch: 'vixl/feature',
      message:
        'Worktree created and registered. Call move_workspace with this rootPath if the current chat should continue inside it, or pass this slug as workspaceSlug to spawn_subagent for an isolated implementer.',
    })
  })

  it('rolls back the checkout when registration fails', async () => {
    registryAddProject.mockRejectedValue(new Error('disk full'))
    const result = await execute({ name: 'feature' })

    expect(gitWorktreeAdd).toHaveBeenCalled()
    expect(gitWorktreeRemove).toHaveBeenCalledWith(
      '/tmp/project',
      '/tmp/worktrees/demo/feature',
      true,
    )
    expect(result).toEqual({
      error:
        'Worktree created at /tmp/worktrees/demo/feature but registration failed: disk full. Removed the checkout; delete branch vixl/feature before retrying.',
    })
  })

  it('returns ok when fleet refresh fails after a successful register', async () => {
    refreshFleetProjects.mockRejectedValue(new Error('fleet locked'))
    const result = await execute({ name: 'feature' })

    expect(gitWorktreeRemove).not.toHaveBeenCalled()
    expect(registryAddProject).toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      slug: 'feature',
      rootPath: '/tmp/worktrees/demo/feature',
      branch: 'vixl/feature',
      message:
        'Worktree created and registered. Call move_workspace with this rootPath if the current chat should continue inside it, or pass this slug as workspaceSlug to spawn_subagent for an isolated implementer. Sidebar may need a reload.',
    })
    expect(getFleetProjects().some((project) => project.slug === 'feature')).toBe(true)
  })
})
