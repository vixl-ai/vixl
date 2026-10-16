import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const fsListDir = vi.hoisted(() =>
  vi.fn<
    (
      projectRoot: string,
      path: string,
      projectRoots?: Array<{ slug: string; path: string }>,
    ) => Promise<Array<{ name: string; path: string; kind: string }>>
  >(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsListDir: (
      projectRoot: string,
      path: string,
      projectRoots?: Array<{ slug: string; path: string }>,
    ) => fsListDir(projectRoot, path, projectRoots),
  }),
)

import listDir from '@/services/harness/read/list-dir'

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
  ...overrides,
})

const execute = async (
  input: Record<string, unknown>,
  ctx: HarnessToolContext = baseCtx(),
): Promise<unknown> => {
  const built = listDir(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('list_dir tool', () => {
  beforeEach(() => {
    fsListDir.mockReset()
    fsListDir.mockResolvedValue([{ name: 'src', path: 'src', kind: 'directory' }])
  })

  it('forwards . to fsListDir in a single-project chat', async () => {
    await execute({ path: '.' })
    expect(fsListDir).toHaveBeenCalledWith('/tmp/project', '.', undefined)
  })

  it('returns workspace members when path is omitted in a group chat', async () => {
    const ctx = baseCtx({
      projectRoot: '/tmp/api',
      projectSlug: 'stack',
      members: [api, web],
    })
    const result = await execute({ path: '.' }, ctx)

    expect(fsListDir).not.toHaveBeenCalled()
    expect(result).toEqual([
      { name: 'api', path: 'api', kind: 'directory' },
      { name: 'web', path: 'web', kind: 'directory' },
    ])
  })

  it('returns workspace members when path is ./ in a group chat', async () => {
    const ctx = baseCtx({
      projectRoot: '/tmp/api',
      projectSlug: 'stack',
      members: [api, web],
    })
    const result = await execute({ path: './' }, ctx)

    expect(fsListDir).not.toHaveBeenCalled()
    expect(result).toEqual([
      { name: 'api', path: 'api', kind: 'directory' },
      { name: 'web', path: 'web', kind: 'directory' },
    ])
  })

  it('forwards a slug-prefixed path to fsListDir with projectRoots', async () => {
    const ctx = baseCtx({
      projectRoot: '/tmp/api',
      projectSlug: 'stack',
      members: [api, web],
    })
    fsListDir.mockResolvedValue([
      { name: 'index.ts', path: 'web/src/index.ts', kind: 'file' },
    ])

    const result = await execute({ path: 'web/src' }, ctx)

    expect(fsListDir).toHaveBeenCalledWith('/tmp/api', 'web/src', [
      { slug: 'api', path: '/tmp/api' },
      { slug: 'web', path: '/tmp/web' },
    ])
    expect(result).toEqual([
      { name: 'index.ts', path: 'web/src/index.ts', kind: 'file' },
    ])
  })

  it('tells the model that omitting path lists members in a group chat', () => {
    const built = listDir(
      baseCtx({
        projectRoot: '/tmp/api',
        projectSlug: 'stack',
        members: [api, web],
      }),
    )
    expect(built.description).toContain('list workspace members')
  })

  it('forwards . to fsListDir when a group has a single member', async () => {
    const ctx = baseCtx({
      projectRoot: '/tmp/api',
      projectSlug: 'stack',
      members: [api],
    })
    await execute({ path: '.' }, ctx)
    expect(fsListDir).toHaveBeenCalledWith('/tmp/api', '.', [
      { slug: 'api', path: '/tmp/api' },
    ])
  })

  it('does not tell the model to list members when a group has a single member', () => {
    const built = listDir(
      baseCtx({
        projectRoot: '/tmp/api',
        projectSlug: 'stack',
        members: [api],
      }),
    )
    expect(built.description).not.toContain('list workspace members')
    expect(built.description).not.toContain('prefixed with a project slug')
  })
})
