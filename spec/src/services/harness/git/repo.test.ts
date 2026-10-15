import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const gitStatusCommand = vi.hoisted(() =>
  vi.fn<(projectRoot: string, projectRoots?: unknown) => Promise<unknown>>(),
)
const gitCommitCommand = vi.hoisted(() =>
  vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
)
const gitDiffCommand = vi.hoisted(() =>
  vi.fn<(args: Record<string, unknown>) => Promise<{ diff: string }>>(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    gitStatus: (projectRoot: string, projectRoots?: unknown) =>
      gitStatusCommand(projectRoot, projectRoots),
    gitCommit: (args: Record<string, unknown>) => gitCommitCommand(args),
    gitDiff: (args: Record<string, unknown>) => gitDiffCommand(args),
  }),
)

vi.mock('@/services/harness/permission/gate', () => ({
  gateToolPermission: vi.fn<() => Promise<boolean>>(async () => true),
}))

import gitStatus from '@/services/harness/git/status'
import gitCommit from '@/services/harness/git/commit'
import gitDiff from '@/services/harness/git/diff'

const api: HarnessWorkspaceMember = {
  slug: 'api',
  name: 'API',
  rootPath: '/tmp/api',
}
const web: HarnessWorkspaceMember = {
  slug: 'web',
  name: 'Web',
  rootPath: '/tmp/web',
}

const baseCtx = (overrides?: Partial<HarnessToolContext>): HarnessToolContext => ({
  projectRoot: '/tmp/api',
  projectSlug: 'stack',
  members: [api, web],
  chatId: 'chat-1',
  mode: 'agent',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
  ...overrides,
})

const execute = async (
  built: { execute?: unknown },
  input: Record<string, unknown>,
): Promise<unknown> => {
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('git tool repo resolution', () => {
  beforeEach(() => {
    gitStatusCommand.mockReset()
    gitCommitCommand.mockReset()
    gitDiffCommand.mockReset()
    gitStatusCommand.mockResolvedValue({ branch: 'main', entries: [] })
    gitCommitCommand.mockResolvedValue({ hash: 'abc', message: 'm', output: '' })
    gitDiffCommand.mockResolvedValue({ diff: '' })
  })

  it('defaults git_status to the primary root and forwards projectRoots', async () => {
    await execute(gitStatus(baseCtx()), {})

    expect(gitStatusCommand).toHaveBeenCalledWith('/tmp/api', [
      { slug: 'api', path: '/tmp/api' },
      { slug: 'web', path: '/tmp/web' },
    ])
  })

  it('resolves git_status repo to that member root', async () => {
    await execute(gitStatus(baseCtx()), { repo: 'web' })

    expect(gitStatusCommand).toHaveBeenCalledWith('/tmp/web', [
      { slug: 'api', path: '/tmp/api' },
      { slug: 'web', path: '/tmp/web' },
    ])
  })

  it('rejects an unknown git_status repo slug', async () => {
    await expect(execute(gitStatus(baseCtx()), { repo: 'mobile' })).rejects.toThrow(
      /Unknown project slug/,
    )
    expect(gitStatusCommand).not.toHaveBeenCalled()
  })

  it('passes the resolved repo root and projectRoots to git_commit', async () => {
    await execute(gitCommit(baseCtx()), {
      message: 'fix',
      paths: ['web/src/a.ts'],
      repo: 'web',
    })

    expect(gitCommitCommand).toHaveBeenCalledWith({
      projectRoot: '/tmp/web',
      message: 'fix',
      paths: ['web/src/a.ts'],
      projectRoots: [
        { slug: 'api', path: '/tmp/api' },
        { slug: 'web', path: '/tmp/web' },
      ],
    })
  })

  it('passes the resolved repo root to git_diff', async () => {
    await execute(gitDiff(baseCtx()), { repo: 'web', path: 'web/src/a.ts' })

    expect(gitDiffCommand).toHaveBeenCalledWith({
      projectRoot: '/tmp/web',
      path: 'web/src/a.ts',
      staged: undefined,
      base: undefined,
      projectRoots: [
        { slug: 'api', path: '/tmp/api' },
        { slug: 'web', path: '/tmp/web' },
      ],
    })
  })

  it('does not send projectRoots for a single-project chat', async () => {
    const ctx = baseCtx({
      members: undefined,
      projectRoot: '/tmp/project',
      projectSlug: 'project',
    })
    await execute(gitStatus(ctx), {})
    expect(gitStatusCommand).toHaveBeenCalledWith('/tmp/project', undefined)
  })
})
