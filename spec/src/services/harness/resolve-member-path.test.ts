import { describe, expect, it } from 'vitest'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import resolveMemberPath from '@/services/harness/resolve-member-path'

const member = (slug: string, rootPath: string, name = slug): HarnessWorkspaceMember => ({
  slug,
  name,
  rootPath,
})

describe('resolveMemberPath', () => {
  it('selects a member from a leading slug prefix', () => {
    const api = member('api', '/tmp/api')
    const web = member('web', '/tmp/web')

    expect(resolveMemberPath([api, web], 'api/src/foo.ts')).toEqual({
      memberSlug: 'api',
      root: '/tmp/api',
      relativePath: 'src/foo.ts',
    })
  })

  it('rejects unprefixed relative paths when multiple roots exist', () => {
    const api = member('api', '/tmp/api')
    const web = member('web', '/tmp/web')

    expect(() => resolveMemberPath([api, web], 'src/foo.ts')).toThrow(
      /prefixed with a project slug/,
    )
    expect(() => resolveMemberPath([api, web], 'src/foo.ts')).toThrow(/api/)
    expect(() => resolveMemberPath([api, web], 'src/foo.ts')).toThrow(/web/)
  })

  it('allows unprefixed relative paths when a single root exists', () => {
    const api = member('api', '/tmp/api')

    expect(resolveMemberPath([api], 'src/foo.ts')).toEqual({
      memberSlug: 'api',
      root: '/tmp/api',
      relativePath: 'src/foo.ts',
    })
  })

  it('accepts an absolute path inside a member root', () => {
    const api = member('api', '/tmp/api')
    const web = member('web', '/tmp/web')

    expect(resolveMemberPath([api, web], '/tmp/api/src/foo.ts')).toEqual({
      memberSlug: 'api',
      root: '/tmp/api',
      relativePath: 'src/foo.ts',
    })
  })

  it('rejects an absolute path outside all member roots', () => {
    const api = member('api', '/tmp/api')
    const web = member('web', '/tmp/web')

    expect(() => resolveMemberPath([api, web], '/tmp/outside/secret.txt')).toThrow(
      'Absolute path is outside all project roots',
    )
  })

  it('rejects parent directory traversal', () => {
    const api = member('api', '/tmp/api')
    const web = member('web', '/tmp/web')

    expect(() => resolveMemberPath([api, web], 'api/../web/src/foo.ts')).toThrow(
      'Path traversal is not allowed',
    )
  })

  it('skips a leading curdir segment when matching a slug prefix', () => {
    const api = member('api', '/tmp/api')
    const web = member('web', '/tmp/web')

    expect(resolveMemberPath([api, web], './api/src/foo.ts')).toEqual({
      memberSlug: 'api',
      root: '/tmp/api',
      relativePath: 'src/foo.ts',
    })
  })

  it('picks the longest matching root for nested absolute paths', () => {
    const outer = member('outer', '/tmp/proj')
    const inner = member('inner', '/tmp/proj/nested')

    expect(resolveMemberPath([outer, inner], '/tmp/proj/nested/src/foo.ts')).toEqual({
      memberSlug: 'inner',
      root: '/tmp/proj/nested',
      relativePath: 'src/foo.ts',
    })
  })

  it('rejects a slug prefix for a member whose project root is gone', () => {
    const api = member('api', '/tmp/api')
    const web = member('web', '')

    expect(() => resolveMemberPath([api, web], 'web/src/foo.ts')).toThrow(
      'Project web is no longer available',
    )
    expect(resolveMemberPath([api, web], 'api/src/foo.ts')).toEqual({
      memberSlug: 'api',
      root: '/tmp/api',
      relativePath: 'src/foo.ts',
    })
    expect(() => resolveMemberPath([api, web], 'src/foo.ts')).toThrow(
      /prefixed with a project slug/,
    )
  })

  it('requires at least one member and a non-empty path', () => {
    expect(() => resolveMemberPath([], 'api/src/foo.ts')).toThrow(
      'At least one workspace root is required',
    )
    expect(() => resolveMemberPath([member('api', '/tmp/api')], '   ')).toThrow(
      'Path is required',
    )
  })
})
