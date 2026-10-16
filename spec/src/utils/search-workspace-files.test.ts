import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

const workspaceGlob = vi.hoisted(() =>
  vi.fn<
    (
      projectRoot: string,
      pattern: string,
      limit?: number,
      projectRoots?: Array<{ slug: string; path: string }>,
    ) => Promise<{ files: Array<{ path: string }>; truncated: boolean }>
  >(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    workspaceGlob: (
      projectRoot: string,
      pattern: string,
      limit?: number,
      projectRoots?: Array<{ slug: string; path: string }>,
    ) => workspaceGlob(projectRoot, pattern, limit, projectRoots),
  }),
)

import searchWorkspaceFiles from '@/utils/search-workspace-files'

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

describe('searchWorkspaceFiles', () => {
  beforeEach(() => {
    workspaceGlob.mockReset()
    workspaceGlob.mockResolvedValue({ files: [], truncated: false })
  })

  it('returns an empty list when projectRoot is missing', async () => {
    await expect(searchWorkspaceFiles(null, 'foo')).resolves.toEqual([])
    expect(workspaceGlob).not.toHaveBeenCalled()
  })

  it('globs the primary root without projectRoots for a single-project chat', async () => {
    workspaceGlob.mockResolvedValue({
      files: [{ path: 'src/a.ts' }, { path: 'src/foo.ts' }],
      truncated: false,
    })

    const files = await searchWorkspaceFiles('/tmp/api', 'foo')

    expect(workspaceGlob).toHaveBeenCalledWith('/tmp/api', '*foo*', 40, undefined)
    expect(files).toEqual(['src/foo.ts', 'src/a.ts'])
  })

  it('passes member projectRoots so group search is slug-prefixed', async () => {
    workspaceGlob.mockResolvedValue({
      files: [{ path: 'web/src/a.ts' }, { path: 'api/src/a.ts' }],
      truncated: false,
    })

    const files = await searchWorkspaceFiles('/tmp/api', 'a.ts', 40, [api, web])

    expect(workspaceGlob).toHaveBeenCalledWith('/tmp/api', '*a.ts*', 40, [
      { slug: 'api', path: '/tmp/api' },
      { slug: 'web', path: '/tmp/web' },
    ])
    expect(files).toEqual(['api/src/a.ts', 'web/src/a.ts'])
  })

  it('omits projectRoots when only one member is present', async () => {
    await searchWorkspaceFiles('/tmp/api', 'foo', 40, [api])

    expect(workspaceGlob).toHaveBeenCalledWith('/tmp/api', '*foo*', 40, undefined)
  })

  it('omits members whose project root is gone from group search', async () => {
    const missingWeb: HarnessWorkspaceMember = {
      slug: 'web',
      name: 'web',
      rootPath: '',
    }
    await searchWorkspaceFiles('/tmp/api', 'foo', 40, [api, missingWeb])

    expect(workspaceGlob).toHaveBeenCalledWith('/tmp/api', '*foo*', 40, [
      { slug: 'api', path: '/tmp/api' },
    ])
  })
})
