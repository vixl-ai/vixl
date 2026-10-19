import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { ChatMetaRecord } from '@/services/vixl/vixl-tauri/types'
import type { SubagentRecord } from '@/types/harness/subagent-record'

const gateWorkspaceMovePermission = vi.hoisted(() =>
  vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
)

const gitWorktreeRemove = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

const gitWorktreeList = vi.hoisted(() =>
  vi.fn<(root: string) => Promise<unknown[]>>().mockResolvedValue([]),
)

const registryRemoveProject = vi.hoisted(() =>
  vi.fn<(projectId: string) => Promise<void>>().mockResolvedValue(undefined),
)

const listChats = vi.hoisted(() =>
  vi.fn<(slug: string) => Promise<ChatMetaRecord[]>>().mockResolvedValue([]),
)

const gitStatus = vi.hoisted(() =>
  vi.fn<(root: string) => Promise<{ branch: string | null; entries: unknown[] }>>(),
)

const worktreeDetectParent = vi.hoisted(() =>
  vi.fn<(path: string) => Promise<unknown>>().mockResolvedValue(null),
)

const getFleetProjects = vi.hoisted(() => vi.fn<() => FleetProject[]>())
const ensureFleetLoaded = vi.hoisted(() =>
  vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
)
const refreshFleetProjects = vi.hoisted(() =>
  vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
)

const activeSubagentsForWorkspace = vi.hoisted(() =>
  vi.fn<(slug: string, rootPath?: string) => SubagentRecord[]>().mockReturnValue([]),
)

vi.mock('@/services/harness/permission', () => ({
  gateWorkspaceMovePermission,
}))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  gitWorktreeRemove,
  gitWorktreeList,
  registryRemoveProject,
  listChats,
  gitStatus,
  worktreeDetectParent,
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  getFleetProjects,
  ensureFleetLoaded,
  refreshFleetProjects,
}))

vi.mock('@/services/harness/subagent/active-for-workspace', () => ({
  activeSubagentsForWorkspace,
}))

import worktreeRemove from '@/services/harness/workspace/worktree-remove'

const parentProject: FleetProject = {
  id: 'proj-parent',
  name: 'demo',
  slug: 'demo',
  rootPath: '/tmp/project',
  lastOpened: '2026-01-01T00:00:00.000Z',
}

const worktreeProject: FleetProject = {
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

const idleChat = (slug: string): ChatMetaRecord => ({
  id: 'chat-2',
  title: 'Chat',
  projectSlug: slug,
  projectRoot: '/tmp/worktrees/demo/feature',
  mode: 'agent',
  model: 'test',
  status: 'idle',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  forkedFrom: null,
  pinned: false,
  pinnedAt: null,
})

const runningChat = (slug: string): ChatMetaRecord => ({
  ...idleChat(slug),
  id: 'chat-running',
  status: 'running',
})

const baseCtx = (): HarnessToolContext => ({
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
})

const execute = async (
  input: Record<string, unknown>,
  ctx: HarnessToolContext = baseCtx(),
): Promise<unknown> => {
  const built = worktreeRemove(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('worktree_remove tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateWorkspaceMovePermission.mockResolvedValue(true)
    gitWorktreeRemove.mockResolvedValue(undefined)
    gitWorktreeList.mockResolvedValue([])
    registryRemoveProject.mockResolvedValue(undefined)
    refreshFleetProjects.mockResolvedValue(undefined)
    ensureFleetLoaded.mockResolvedValue(undefined)
    getFleetProjects.mockReturnValue([parentProject, worktreeProject])
    listChats.mockResolvedValue([idleChat('feature')])
    gitStatus.mockResolvedValue({ branch: 'vixl/feature', entries: [] })
    worktreeDetectParent.mockResolvedValue(null)
    activeSubagentsForWorkspace.mockReturnValue([])
  })

  it('refuses on a subagent without prompting', async () => {
    const ctx = baseCtx()
    ctx.subagentId = 'sub-1'
    const result = await execute(
      { rootPath: '/tmp/worktrees/demo/feature' },
      ctx,
    )

    expect(result).toEqual({
      error: 'worktree_remove can only run on the parent chat',
    })
    expect(gateWorkspaceMovePermission).not.toHaveBeenCalled()
    expect(gitWorktreeRemove).not.toHaveBeenCalled()
    expect(registryRemoveProject).not.toHaveBeenCalled()
  })

  it('rejects removing the current chat root by default', async () => {
    const result = await execute({})

    expect(result).toEqual({
      error:
        'worktree_remove cannot remove the current chat workspace; pass a different rootPath',
    })
    expect(gitWorktreeRemove).not.toHaveBeenCalled()
    expect(registryRemoveProject).not.toHaveBeenCalled()
  })

  it('refuses when a chat is running on the worktree slug', async () => {
    listChats.mockResolvedValue([runningChat('feature')])
    const result = await execute({ rootPath: '/tmp/worktrees/demo/feature' })

    expect(result).toEqual({
      error: 'Cannot remove worktree while 1 chat(s) are running on feature',
    })
    expect(gateWorkspaceMovePermission).not.toHaveBeenCalled()
    expect(gitWorktreeRemove).not.toHaveBeenCalled()
    expect(registryRemoveProject).not.toHaveBeenCalled()
  })

  it('refuses when an active implementer targets the worktree', async () => {
    activeSubagentsForWorkspace.mockReturnValue([
      {
        subagentId: 'sub-1',
        chatId: 'chat-parent',
        toolCallId: 'tc-1',
        agentName: 'implementer',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        workspace: {
          projectRoot: '/tmp/worktrees/demo/feature',
          projectSlug: 'feature',
        },
      },
    ])
    const result = await execute({ rootPath: '/tmp/worktrees/demo/feature' })

    expect(activeSubagentsForWorkspace).toHaveBeenCalledWith(
      'feature',
      '/tmp/worktrees/demo/feature',
    )
    expect(result).toEqual({
      error:
        'Cannot remove worktree while 1 active implementer(s) are running on feature',
    })
    expect(gateWorkspaceMovePermission).not.toHaveBeenCalled()
    expect(gitWorktreeRemove).not.toHaveBeenCalled()
    expect(registryRemoveProject).not.toHaveBeenCalled()
  })

  it('removes the git worktree and unregisters the fleet project', async () => {
    const result = await execute({ rootPath: '/tmp/worktrees/demo/feature' })

    expect(gitWorktreeRemove).toHaveBeenCalledWith(
      '/tmp/project',
      '/tmp/worktrees/demo/feature',
      false,
    )
    expect(registryRemoveProject).toHaveBeenCalledWith('proj-wt')
    expect(refreshFleetProjects).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ok: true,
      message:
        'Removed worktree vixl/feature at /tmp/worktrees/demo/feature and unregistered it from the fleet.',
    })
  })

  it('implies force when the approved dialog showed Dirty: yes', async () => {
    gitStatus.mockResolvedValue({
      branch: 'vixl/feature',
      entries: [{ path: 'src/a.ts', isUntracked: false, isIgnored: false }],
    })
    const result = await execute({ rootPath: '/tmp/worktrees/demo/feature' })

    expect(result).toMatchObject({ ok: true })
    expect(gateWorkspaceMovePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('Dirty: yes'),
      }),
    )
    expect(gitWorktreeRemove).toHaveBeenCalledWith(
      '/tmp/project',
      '/tmp/worktrees/demo/feature',
      true,
    )
  })

  it('does not imply force when dirty is unknown', async () => {
    gitStatus.mockRejectedValue(new Error('Not a git repository'))
    const result = await execute({ rootPath: '/tmp/worktrees/demo/feature' })

    expect(result).toMatchObject({ ok: true })
    expect(gitWorktreeRemove).toHaveBeenCalledWith(
      '/tmp/project',
      '/tmp/worktrees/demo/feature',
      false,
    )
  })

  it('forces when the caller passes force true', async () => {
    const result = await execute({
      rootPath: '/tmp/worktrees/demo/feature',
      force: true,
    })

    expect(result).toMatchObject({ ok: true })
    expect(gitWorktreeRemove).toHaveBeenCalledWith(
      '/tmp/project',
      '/tmp/worktrees/demo/feature',
      true,
    )
  })

  it('refuses after approval if a chat starts during the prompt', async () => {
    gateWorkspaceMovePermission.mockImplementation(async () => {
      listChats.mockResolvedValue([runningChat('feature')])
      return true
    })
    const result = await execute({ rootPath: '/tmp/worktrees/demo/feature' })

    expect(gateWorkspaceMovePermission).toHaveBeenCalled()
    expect(result).toEqual({
      error: 'Cannot remove worktree while 1 chat(s) are running on feature',
    })
    expect(gitWorktreeRemove).not.toHaveBeenCalled()
    expect(registryRemoveProject).not.toHaveBeenCalled()
  })

  it('falls back to the worktree path when the parent is not in the fleet', async () => {
    getFleetProjects.mockReturnValue([worktreeProject])
    worktreeDetectParent.mockResolvedValue(null)
    const result = await execute({ rootPath: '/tmp/worktrees/demo/feature' })

    expect(result).toMatchObject({ ok: true })
    expect(gitWorktreeRemove).toHaveBeenCalledWith(
      '/tmp/worktrees/demo/feature',
      '/tmp/worktrees/demo/feature',
      false,
    )
  })

  it('resolves when fleet stores /tmp and git reports /private/tmp', async () => {
    const tmpPath = '/tmp/worktrees/demo/feature'
    const privatePath = '/private/tmp/worktrees/demo/feature'
    getFleetProjects.mockReturnValue([
      parentProject,
      { ...worktreeProject, rootPath: tmpPath },
    ])
    gitWorktreeList.mockResolvedValue([
      {
        path: privatePath,
        branch: 'vixl/feature',
        bare: false,
        detached: false,
      },
    ])
    const result = await execute({ rootPath: tmpPath })

    expect(result).toMatchObject({ ok: true })
    expect(gitWorktreeRemove).toHaveBeenCalledWith('/tmp/project', tmpPath, false)
    expect(registryRemoveProject).toHaveBeenCalledWith('proj-wt')
  })

  it('resolves when the caller passes /private/tmp and fleet stores /tmp', async () => {
    const tmpPath = '/tmp/worktrees/demo/feature'
    const privatePath = '/private/tmp/worktrees/demo/feature'
    getFleetProjects.mockReturnValue([
      parentProject,
      { ...worktreeProject, rootPath: tmpPath },
    ])
    gitWorktreeList.mockResolvedValue([
      {
        path: privatePath,
        branch: 'vixl/feature',
        bare: false,
        detached: false,
      },
    ])
    const result = await execute({ rootPath: privatePath })

    expect(result).toMatchObject({ ok: true })
    expect(gitWorktreeRemove).toHaveBeenCalledWith('/tmp/project', tmpPath, false)
    expect(registryRemoveProject).toHaveBeenCalledWith('proj-wt')
  })

  it('resolves when fleet stores /private/tmp and the caller passes /tmp', async () => {
    const tmpPath = '/tmp/worktrees/demo/feature'
    const privatePath = '/private/tmp/worktrees/demo/feature'
    getFleetProjects.mockReturnValue([
      parentProject,
      { ...worktreeProject, rootPath: privatePath },
    ])
    gitWorktreeList.mockResolvedValue([
      {
        path: privatePath,
        branch: 'vixl/feature',
        bare: false,
        detached: false,
      },
    ])
    const result = await execute({ rootPath: tmpPath })

    expect(result).toMatchObject({ ok: true })
    expect(gitWorktreeRemove).toHaveBeenCalledWith(
      '/tmp/project',
      privatePath,
      false,
    )
    expect(registryRemoveProject).toHaveBeenCalledWith('proj-wt')
  })

  it('does not match a suffix-only rootPath to a longer worktree path', async () => {
    gitWorktreeList.mockResolvedValue([
      {
        path: '/tmp/worktrees/demo/feature',
        branch: 'vixl/feature',
        bare: false,
        detached: false,
      },
    ])
    const result = await execute({ rootPath: '/demo/feature' })

    expect(result).toEqual({
      error: 'No fleet project matches that worktree path',
    })
    expect(gitWorktreeRemove).not.toHaveBeenCalled()
    expect(registryRemoveProject).not.toHaveBeenCalled()
  })

  it('treats a not-a-worktree git error as already removed and unregisters', async () => {
    gitWorktreeRemove.mockRejectedValue(
      new Error('Path is not a worktree of this repository'),
    )
    const result = await execute({ rootPath: '/tmp/worktrees/demo/feature' })

    expect(registryRemoveProject).toHaveBeenCalledWith('proj-wt')
    expect(refreshFleetProjects).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ok: true,
      message:
        'Removed worktree vixl/feature at /tmp/worktrees/demo/feature and unregistered it from the fleet.',
    })
  })

  it('returns ok with a warning when unregister fails after git remove', async () => {
    registryRemoveProject.mockRejectedValue(new Error('registry down'))
    const result = await execute({ rootPath: '/tmp/worktrees/demo/feature' })

    expect(gitWorktreeRemove).toHaveBeenCalled()
    expect(refreshFleetProjects).toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      warning: 'Checkout is gone. Remove the row from the sidebar if it lingers.',
      message:
        'Removed worktree vixl/feature at /tmp/worktrees/demo/feature. Checkout is gone. Remove the row from the sidebar if it lingers.',
    })
  })
})
