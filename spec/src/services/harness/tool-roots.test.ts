import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

const notifyWorkspaceFsMutation = vi.hoisted(() =>
  vi.fn<(projectRoot: string, paths: string[]) => void>(),
)

vi.mock('@/services/harness/shared/notify-fs-mutation', () => ({
  notifyWorkspaceFsMutation,
}))

import {
  checkpointCaptureTarget,
  ipcProjectRoots,
  isMultiRootWorkspace,
  MULTI_ROOT_PATH_HINT,
  notifyWorkspaceMutations,
  permissionPath,
  resolveWorkspaceSlug,
  sensitiveCheckPaths,
  withMultiRootPathHint,
  withProjectRoots,
} from '@/services/harness/tool-roots'

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

describe('withMultiRootPathHint', () => {
  it('returns the original string when members are absent', () => {
    expect(withMultiRootPathHint('Git status', {})).toBe('Git status')
    expect(isMultiRootWorkspace({})).toBe(false)
  })

  it('appends the slug hint when members exist', () => {
    expect(withMultiRootPathHint('Git status', { members: [api, web] })).toBe(
      `Git status ${MULTI_ROOT_PATH_HINT}`,
    )
    expect(isMultiRootWorkspace({ members: [api, web] })).toBe(true)
  })
})

describe('ipcProjectRoots', () => {
  it('returns undefined when members are missing', () => {
    expect(ipcProjectRoots({})).toBeUndefined()
    expect(ipcProjectRoots({ members: [] })).toBeUndefined()
  })

  it('maps slug and rootPath into the IPC payload', () => {
    expect(ipcProjectRoots({ members: [api, web] })).toEqual([
      { slug: 'api', path: '/tmp/api' },
      { slug: 'web', path: '/tmp/web' },
    ])
  })
})

describe('withProjectRoots', () => {
  it('leaves args unchanged when there are no members', () => {
    const args = { projectRoot: '/tmp/api', path: 'src/a.ts' }
    expect(withProjectRoots(args, {})).toBe(args)
  })

  it('adds projectRoots when members exist', () => {
    expect(
      withProjectRoots({ projectRoot: '/tmp/api', path: 'api/src/a.ts' }, { members: [api, web] }),
    ).toEqual({
      projectRoot: '/tmp/api',
      path: 'api/src/a.ts',
      projectRoots: [
        { slug: 'api', path: '/tmp/api' },
        { slug: 'web', path: '/tmp/web' },
      ],
    })
  })
})

describe('resolveWorkspaceSlug', () => {
  it('uses the primary root when members are absent', () => {
    expect(resolveWorkspaceSlug({ projectRoot: '/tmp/project' }, 'api')).toEqual({
      projectRoot: '/tmp/project',
      slug: undefined,
    })
  })

  it('defaults to the primary root and its slug', () => {
    expect(resolveWorkspaceSlug({ projectRoot: '/tmp/api', members: [api, web] })).toEqual({
      projectRoot: '/tmp/api',
      slug: 'api',
    })
  })

  it('falls back to the first member root when projectRoot is not a member', () => {
    expect(
      resolveWorkspaceSlug({ projectRoot: '/tmp/gone', members: [api, web] }),
    ).toEqual({
      projectRoot: '/tmp/api',
      slug: 'api',
    })
  })

  it('resolves a member slug to that member root', () => {
    expect(
      resolveWorkspaceSlug({ projectRoot: '/tmp/api', members: [api, web] }, 'web'),
    ).toEqual({
      projectRoot: '/tmp/web',
      slug: 'web',
    })
  })

  it('rejects an unknown slug and lists valid slugs', () => {
    expect(() =>
      resolveWorkspaceSlug({ projectRoot: '/tmp/api', members: [api, web] }, 'mobile'),
    ).toThrow(/Unknown project slug/)
    expect(() =>
      resolveWorkspaceSlug({ projectRoot: '/tmp/api', members: [api, web] }, 'mobile'),
    ).toThrow(/api/)
    expect(() =>
      resolveWorkspaceSlug({ projectRoot: '/tmp/api', members: [api, web] }, 'mobile'),
    ).toThrow(/web/)
  })
})

describe('permissionPath', () => {
  it('returns the input path when members are absent', () => {
    expect(permissionPath(undefined, 'src/.env')).toBe('src/.env')
  })

  it('prefixes a resolved member path so keys do not collide', () => {
    expect(permissionPath([api, web], 'api/src/.env')).toBe('api/src/.env')
    expect(permissionPath([api, web], 'web/src/.env')).toBe('web/src/.env')
    expect(permissionPath([api], 'src/.env')).toBe('api/src/.env')
  })
})

describe('sensitiveCheckPaths', () => {
  it('returns the input path when members are absent', () => {
    expect(sensitiveCheckPaths(undefined, ['src/.env'])).toEqual(['src/.env'])
  })

  it('strips the member slug so a credentials slug is not itself sensitive', () => {
    const credentials: HarnessWorkspaceMember = {
      slug: 'credentials',
      name: 'Credentials',
      rootPath: '/tmp/credentials',
    }
    expect(sensitiveCheckPaths([credentials], ['credentials/src/index.ts'])).toEqual([
      'src/index.ts',
    ])
    expect(sensitiveCheckPaths([api, web], ['api/src/.env'])).toEqual(['src/.env'])
  })
})

describe('checkpointCaptureTarget', () => {
  it('uses the member root and unprefixed relative path', () => {
    expect(
      checkpointCaptureTarget({ projectRoot: '/tmp/api', members: [api, web] }, 'web/src/a.ts'),
    ).toEqual({
      projectRoot: '/tmp/web',
      path: 'src/a.ts',
    })
  })
})

describe('notifyWorkspaceMutations', () => {
  beforeEach(() => {
    notifyWorkspaceFsMutation.mockReset()
  })

  it('notifies the project root with the given paths when members are absent', () => {
    notifyWorkspaceMutations({ projectRoot: '/tmp/project' }, ['src/a.ts'])
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledTimes(1)
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/project', ['src/a.ts'])
  })

  it('notifies each member root with member-relative paths', () => {
    notifyWorkspaceMutations(
      { projectRoot: '/tmp/api', members: [api, web] },
      ['web/src/foo.ts', 'api/src/bar.ts', 'web/lib/baz.ts'],
    )

    expect(notifyWorkspaceFsMutation).toHaveBeenCalledTimes(2)
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/web', [
      'src/foo.ts',
      'lib/baz.ts',
    ])
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/api', ['src/bar.ts'])
  })
})
