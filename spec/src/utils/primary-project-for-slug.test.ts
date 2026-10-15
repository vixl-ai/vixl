import { describe, expect, it } from 'vitest'
import {
  isGroupSlug,
  primaryProjectForSlug,
} from '@/utils/primary-project-for-slug'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { FleetProjectGroup } from '@/types/fleet/fleet-project-group'

const projects: FleetProject[] = [
  {
    id: 'p1',
    name: 'api',
    slug: 'api',
    rootPath: '/tmp/api',
    lastOpened: '',
  },
  {
    id: 'p2',
    name: 'web',
    slug: 'web',
    rootPath: '/tmp/web',
    lastOpened: '',
  },
]

const groups: FleetProjectGroup[] = [
  {
    id: 'g1',
    name: 'api, web',
    slug: 'api-web',
    memberSlugs: ['api', 'web'],
    lastOpened: '',
  },
]

describe('primary-project-for-slug', () => {
  it('returns the matching project for a project slug', () => {
    expect(primaryProjectForSlug('web', projects, groups)?.id).toBe('p2')
  })

  it('returns the first member project for a group slug', () => {
    expect(primaryProjectForSlug('api-web', projects, groups)?.id).toBe('p1')
  })

  it('detects group slugs', () => {
    expect(isGroupSlug('api-web', groups)).toBe(true)
    expect(isGroupSlug('api', groups)).toBe(false)
  })
})
