import { describe, expect, it } from 'vitest'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import projectRootsForSlug from '@/services/plans/project-roots-for-slug'

const projects = [
  { slug: 'api', rootPath: '/tmp/api' },
  { slug: 'web', rootPath: '/tmp/web' },
]
const groups = [
  { slug: 'stack', memberSlugs: ['api', 'web'] },
]

describe('project-roots-for-slug', () => {
  it('returns the home dir for the home slug', () => {
    expect(
      projectRootsForSlug({
        projectSlug: HOME_CHAT_SLUG,
        homeDir: '/Users/test-home',
        projects,
        groups,
      }),
    ).toEqual(['/Users/test-home'])
  })

  it('returns every member root for a group slug', () => {
    expect(
      projectRootsForSlug({
        projectSlug: 'stack',
        projects,
        groups,
      }),
    ).toEqual(['/tmp/api', '/tmp/web'])
  })

  it('returns the matching project root for a project slug', () => {
    expect(
      projectRootsForSlug({
        projectSlug: 'web',
        projects,
        groups,
      }),
    ).toEqual(['/tmp/web'])
  })

  it('returns an empty list when the slug is unknown', () => {
    expect(
      projectRootsForSlug({
        projectSlug: 'missing',
        projects,
        groups,
      }),
    ).toEqual([])
  })
})
