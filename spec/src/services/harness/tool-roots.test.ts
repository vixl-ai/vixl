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
  isAbsolutePath,
  isMultiRootWorkspace,
  joinOntoProjectRoot,
  MULTI_ROOT_PATH_HINT,
  notifyWorkspaceMutations,
  permissionPath,
  relativeUnderProjectRoot,
  resolveWorkspaceSlug,
  sensitiveCheckPaths,
  resolvePlanToolPath,
  toRelativeUnderProjectRoot,
  toWorkspaceRelativePath,
  withMultiRootPathHint,
  withMultiRootSuffix,
  withProjectRoots,
  repoSlugFields,
  cwdSlugFields,
  REPO_TOOL_HINT,
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
      `Git status ${MULTI_ROOT_PATH_HINT([api, web])}`,
    )
    expect(isMultiRootWorkspace({ members: [api, web] })).toBe(true)
  })

  it('uses the first member slug in the path example and lists every slug', () => {
    const platform = { slug: 'platform', name: 'Platform', rootPath: '/tmp/platform' }
    const cms = { slug: 'cms-site-template', name: 'CMS', rootPath: '/tmp/cms' }
    const widgets = { slug: 'site-widgets', name: 'Widgets', rootPath: '/tmp/widgets' }
    const extra = { slug: 'docs', name: 'Docs', rootPath: '/tmp/docs' }
    const hint = MULTI_ROOT_PATH_HINT([platform, cms, widgets, extra])
    expect(hint).toBe(
      'In a multi-project workspace, paths must be prefixed with a project slug (for example platform/src/index.ts). Valid slugs: platform, cms-site-template, site-widgets, docs.',
    )
  })

  it('lists every slug on cwd and repo field descriptions', () => {
    const members = [
      { slug: 'platform', name: 'Platform', rootPath: '/tmp/platform' },
      { slug: 'cms-site-template', name: 'CMS', rootPath: '/tmp/cms' },
      { slug: 'site-widgets', name: 'Widgets', rootPath: '/tmp/widgets' },
    ]
    const ctx = { members }
    const repo = repoSlugFields(ctx) as { repo: { description?: string } }
    const cwd = cwdSlugFields(ctx) as { cwd: { description?: string } }
    expect(repo.repo.description).toContain(
      'Valid slugs: platform, cms-site-template, site-widgets.',
    )
    expect(cwd.cwd.description).toContain(
      'Valid slugs: platform, cms-site-template, site-widgets.',
    )
  })

  it('appends every slug when a repo suffix has none', () => {
    const members = [
      { slug: 'platform', name: 'Platform', rootPath: '/tmp/platform' },
      { slug: 'cms-site-template', name: 'CMS', rootPath: '/tmp/cms' },
    ]
    expect(withMultiRootSuffix('Git status', { members }, REPO_TOOL_HINT)).toBe(
      'Git status Optional repo is a project slug; defaults to the primary project. Valid slugs: platform, cms-site-template.',
    )
  })

  it('treats a single member like a single-root workspace', () => {
    expect(isMultiRootWorkspace({ members: [api] })).toBe(false)
    expect(withMultiRootPathHint('Git status', { members: [api] })).toBe('Git status')
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

  it('keeps a missing member slug in the IPC payload so the jail can reject it', () => {
    const missingWeb: HarnessWorkspaceMember = {
      slug: 'web',
      name: 'web',
      rootPath: '',
    }
    expect(ipcProjectRoots({ members: [api, missingWeb] })).toEqual([
      { slug: 'api', path: '/tmp/api' },
      { slug: 'web', path: '' },
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

  it('rejects a slug whose project root is gone', () => {
    const missingWeb: HarnessWorkspaceMember = {
      slug: 'web',
      name: 'web',
      rootPath: '',
    }
    expect(() =>
      resolveWorkspaceSlug({ projectRoot: '/tmp/api', members: [api, missingWeb] }, 'web'),
    ).toThrow('Project web is no longer available')
  })

  it('rejects a default primary whose project root is gone', () => {
    const missingApi: HarnessWorkspaceMember = {
      slug: 'api',
      name: 'api',
      rootPath: '',
    }
    expect(() =>
      resolveWorkspaceSlug({ projectRoot: '/tmp/api', members: [missingApi, web] }),
    ).toThrow('Project api is no longer available')
    expect(() =>
      resolveWorkspaceSlug({ projectRoot: '', members: [missingApi, web] }),
    ).toThrow('Project api is no longer available')
  })

  it('defaults to a live member that still matches projectRoot when the first slug is gone', () => {
    const missingApi: HarnessWorkspaceMember = {
      slug: 'api',
      name: 'api',
      rootPath: '',
    }
    expect(
      resolveWorkspaceSlug({ projectRoot: '/tmp/web', members: [missingApi, web] }),
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
  it('uses the input path as the manifest key when members are absent', () => {
    expect(checkpointCaptureTarget({ projectRoot: '/tmp/project' }, 'src/a.ts')).toEqual({
      projectRoot: '/tmp/project',
      path: 'src/a.ts',
      key: 'src/a.ts',
    })
  })

  it('keeps a single-member group on the member-relative path', () => {
    expect(
      checkpointCaptureTarget({ projectRoot: '/tmp/api', members: [api] }, 'src/a.ts'),
    ).toEqual({
      projectRoot: '/tmp/api',
      path: 'src/a.ts',
      key: 'src/a.ts',
    })
  })

  it('uses the member root and a slug-prefixed manifest key', () => {
    expect(
      checkpointCaptureTarget({ projectRoot: '/tmp/api', members: [api, web] }, 'web/src/a.ts'),
    ).toEqual({
      projectRoot: '/tmp/web',
      path: 'src/a.ts',
      key: 'web/src/a.ts',
    })
  })

  it('throws when capturing a path for a member whose project is gone', () => {
    const missingWeb: HarnessWorkspaceMember = {
      slug: 'web',
      name: 'web',
      rootPath: '',
    }
    expect(() =>
      checkpointCaptureTarget(
        { projectRoot: '/tmp/api', members: [api, missingWeb] },
        'web/src/a.ts',
      ),
    ).toThrow('Project web is no longer available')
  })

  it('gives colliding relative paths distinct keys per member', () => {
    const ctx = { projectRoot: '/tmp/api', members: [api, web] }
    expect(checkpointCaptureTarget(ctx, 'api/src/a.ts').key).toBe('api/src/a.ts')
    expect(checkpointCaptureTarget(ctx, 'web/src/a.ts').key).toBe('web/src/a.ts')
    expect(checkpointCaptureTarget(ctx, 'api/src/a.ts').path).toBe('src/a.ts')
    expect(checkpointCaptureTarget(ctx, 'web/src/a.ts').path).toBe('src/a.ts')
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

describe('joinOntoProjectRoot and relativeUnderProjectRoot', () => {
  it('joins and strips posix paths with matching separators', () => {
    const root = '/tmp/project'
    const relative = '.vixl/plans/id/PLAN.md'
    const absolute = joinOntoProjectRoot(root, relative)
    expect(absolute).toBe('/tmp/project/.vixl/plans/id/PLAN.md')
    expect(relativeUnderProjectRoot(root, absolute)).toBe(relative)
    expect(toRelativeUnderProjectRoot(root, absolute)).toBe(relative)
    expect(toRelativeUnderProjectRoot(root, relative)).toBe(relative)
  })

  it('joins and strips windows paths with backslash separators', () => {
    const root = 'C:\\Users\\proj'
    const relative = '.vixl/plans/id/PLAN.md'
    const absolute = joinOntoProjectRoot(root, relative)
    expect(absolute).toBe('C:\\Users\\proj\\.vixl\\plans\\id\\PLAN.md')
    expect(relativeUnderProjectRoot(root, absolute)).toBe(relative)
    expect(toRelativeUnderProjectRoot(root, absolute)).toBe(relative)
  })

  it('does not treat a sibling directory as inside the project root', () => {
    expect(
      relativeUnderProjectRoot('/tmp/project', '/tmp/project-other/.vixl/plans/id/PLAN.md'),
    ).toBeNull()
    expect(() =>
      toRelativeUnderProjectRoot(
        '/tmp/project',
        '/tmp/other/.vixl/plans/id/PLAN.md',
      ),
    ).toThrow('Absolute path is outside the project root')
  })

  it('detects posix and windows absolute paths', () => {
    expect(isAbsolutePath('/tmp/project')).toBe(true)
    expect(isAbsolutePath('C:\\Users\\proj')).toBe(true)
    expect(isAbsolutePath('.vixl/plans/id/PLAN.md')).toBe(false)
  })
})

describe('toWorkspaceRelativePath', () => {
  const planPath = '.vixl/plans/id/PLAN.md'

  it('returns the member-relative path in single-project mode', () => {
    expect(
      toWorkspaceRelativePath(
        { projectRoot: '/tmp/project', projectSlug: 'project' },
        planPath,
      ),
    ).toBe(planPath)
    expect(
      toWorkspaceRelativePath(
        { projectRoot: '/tmp/api', projectSlug: 'api', members: [api] },
        planPath,
      ),
    ).toBe(planPath)
  })

  it('prefixes the owning member slug in group mode', () => {
    expect(
      toWorkspaceRelativePath(
        {
          projectRoot: '/tmp/web',
          projectSlug: 'stack',
          members: [api, web],
        },
        planPath,
      ),
    ).toBe(`web/${planPath}`)
  })

  it('falls back to projectSlug then the first member when no root matches', () => {
    expect(
      toWorkspaceRelativePath(
        {
          projectRoot: '/tmp/gone',
          projectSlug: 'web',
          members: [api, web],
        },
        planPath,
      ),
    ).toBe(`web/${planPath}`)
    expect(
      toWorkspaceRelativePath(
        {
          projectRoot: '/tmp/gone',
          projectSlug: '',
          members: [api, web],
        },
        planPath,
      ),
    ).toBe(`api/${planPath}`)
  })
})

describe('resolvePlanToolPath', () => {
  const planPath = '.vixl/plans/id/PLAN.md'
  const groupCtx = {
    projectRoot: '/tmp/api',
    members: [api, web],
  }

  it('strips absolute paths against the project root in single-project mode', () => {
    expect(
      resolvePlanToolPath(
        { projectRoot: '/tmp/project' },
        `/tmp/project/${planPath}`,
      ),
    ).toEqual({
      projectRoot: '/tmp/project',
      relativePath: planPath,
    })
    expect(resolvePlanToolPath({ projectRoot: '/tmp/project' }, planPath)).toEqual({
      projectRoot: '/tmp/project',
      relativePath: planPath,
    })
  })

  it('keeps bare member-relative paths on the current root in group mode', () => {
    expect(resolvePlanToolPath(groupCtx, planPath)).toEqual({
      projectRoot: '/tmp/api',
      relativePath: planPath,
    })
  })

  it('resolves a slug-prefixed path against the named member, including a sibling', () => {
    expect(resolvePlanToolPath(groupCtx, `api/${planPath}`)).toEqual({
      projectRoot: '/tmp/api',
      relativePath: planPath,
    })
    expect(resolvePlanToolPath(groupCtx, `web/${planPath}`)).toEqual({
      projectRoot: '/tmp/web',
      relativePath: planPath,
    })
  })

  it('resolves an absolute path against the owning member by prefix', () => {
    expect(resolvePlanToolPath(groupCtx, `/tmp/web/${planPath}`)).toEqual({
      projectRoot: '/tmp/web',
      relativePath: planPath,
    })
  })

  it('rejects an absolute path outside every member root', () => {
    expect(() =>
      resolvePlanToolPath(groupCtx, `/tmp/other/${planPath}`),
    ).toThrow('Absolute path is outside all project roots')
  })
})
