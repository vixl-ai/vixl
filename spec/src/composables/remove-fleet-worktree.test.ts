import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMetaRecord } from '@/services/vixl/vixl-tauri/types'
import type { SubagentRecord } from '@/types/harness/subagent-record'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'

const gitWorktreeRemove = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
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

const refreshFleetProjects = vi.hoisted(() =>
  vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
)

const activeSubagentsForWorkspace = vi.hoisted(() =>
  vi.fn<(slug: string, rootPath?: string) => SubagentRecord[]>().mockReturnValue([]),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    gitWorktreeRemove,
    registryRemoveProject,
    listChats,
    gitStatus,
  }),
)

vi.mock('@/composables/use-fleet-registry', () => ({
  refreshFleetProjects,
}))

vi.mock('@/services/harness/subagent/active-for-workspace', () => ({
  activeSubagentsForWorkspace,
}))

import {
  confirmRemoveWorktree,
  loadWorktreeRemovePreview,
} from '@/composables/remove-fleet-worktree'

const idleChat = (slug: string): ChatMetaRecord => ({
  id: 'chat-1',
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

describe('remove-fleet-worktree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gitWorktreeRemove.mockResolvedValue(undefined)
    registryRemoveProject.mockResolvedValue(undefined)
    refreshFleetProjects.mockResolvedValue(undefined)
    listChats.mockResolvedValue([idleChat('feature')])
    gitStatus.mockResolvedValue({ branch: 'vixl/feature', entries: [] })
    activeSubagentsForWorkspace.mockReturnValue([])
  })

  it('loads branch, dirty state, and chat count for the confirm dialog', async () => {
    gitStatus.mockResolvedValue({
      branch: 'vixl/feature',
      entries: [{ path: 'a.ts', isUntracked: false, isIgnored: false, unstagedStatus: 'M' }],
    })
    listChats.mockResolvedValue([idleChat('feature'), idleChat('feature')])

    await expect(
      loadWorktreeRemovePreview({
        slug: 'feature',
        rootPath: '/tmp/worktrees/demo/feature',
        branch: 'vixl/feature',
      }),
    ).resolves.toEqual({
      branch: 'vixl/feature',
      dirty: true,
      dirtyLabel: 'yes',
      chatCount: 2,
      runningCount: 0,
      activeSubagentCount: 0,
    })
  })

  it('includes the active implementer count in the confirm dialog preview', async () => {
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
      {
        subagentId: 'sub-2',
        chatId: 'chat-parent',
        toolCallId: 'tc-2',
        agentName: 'implementer',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        workspace: {
          projectRoot: '/tmp/worktrees/demo/feature',
          projectSlug: 'feature',
        },
      },
    ])

    await expect(
      loadWorktreeRemovePreview({
        slug: 'feature',
        rootPath: '/tmp/worktrees/demo/feature',
        branch: 'vixl/feature',
      }),
    ).resolves.toMatchObject({
      activeSubagentCount: 2,
      runningCount: 0,
    })
    expect(activeSubagentsForWorkspace).toHaveBeenCalledWith(
      'feature',
      '/tmp/worktrees/demo/feature',
    )
  })

  it('refuses to remove when a chat on the slug is running', async () => {
    listChats.mockResolvedValue([runningChat('feature')])

    const result = await confirmRemoveWorktree({
      projectId: 'proj-wt',
      slug: 'feature',
      parentRoot: '/tmp/demo',
      worktreeRoot: '/tmp/worktrees/demo/feature',
      force: false,
    })

    expect(result).toEqual({
      ok: false,
      reason: 'running',
      message: 'Cannot remove worktree while 1 chat(s) are running on feature',
    })
    expect(gitWorktreeRemove).not.toHaveBeenCalled()
    expect(registryRemoveProject).not.toHaveBeenCalled()
  })

  it('refuses to remove when an active implementer targets the worktree', async () => {
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

    const result = await confirmRemoveWorktree({
      projectId: 'proj-wt',
      slug: 'feature',
      parentRoot: '/tmp/demo',
      worktreeRoot: '/tmp/worktrees/demo/feature',
      force: false,
    })

    expect(result).toEqual({
      ok: false,
      reason: 'running',
      message:
        'Cannot remove worktree while 1 active implementer(s) are running on feature',
    })
    expect(activeSubagentsForWorkspace).toHaveBeenCalledWith(
      'feature',
      '/tmp/worktrees/demo/feature',
    )
    expect(gitWorktreeRemove).not.toHaveBeenCalled()
    expect(registryRemoveProject).not.toHaveBeenCalled()
  })

  it('removes the git worktree, unregisters the project, and returns ok', async () => {
    const result = await confirmRemoveWorktree({
      projectId: 'proj-wt',
      slug: 'feature',
      parentRoot: '/tmp/demo',
      worktreeRoot: '/tmp/worktrees/demo/feature',
      force: true,
    })

    expect(gitWorktreeRemove).toHaveBeenCalledWith(
      '/tmp/demo',
      '/tmp/worktrees/demo/feature',
      true,
    )
    expect(registryRemoveProject).toHaveBeenCalledWith('proj-wt')
    expect(refreshFleetProjects).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })

  it('returns ok with a warning when unregister fails after git remove', async () => {
    registryRemoveProject.mockRejectedValue(new Error('busy'))
    const result = await confirmRemoveWorktree({
      projectId: 'proj-wt',
      slug: 'feature',
      parentRoot: '/tmp/demo',
      worktreeRoot: '/tmp/worktrees/demo/feature',
      force: true,
    })

    expect(gitWorktreeRemove).toHaveBeenCalled()
    expect(refreshFleetProjects).toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      warning: 'Checkout is gone. Remove the row from the sidebar if it lingers.',
    })
  })
})
