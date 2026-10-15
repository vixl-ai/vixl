import { beforeEach, describe, expect, it } from 'vitest'
import { setFleetGroupReader } from '@/utils/fleet-group-reader'
import projectRouteFor from '@/utils/project-route-for'
import type { FleetProjectGroup } from '@/types/fleet/fleet-project-group'

describe('project-route-for', () => {
  beforeEach(() => {
    setFleetGroupReader(() => [])
  })

  it('uses the project route name for a project slug', () => {
    expect(projectRouteFor('api')).toEqual({
      name: 'project',
      params: { slug: 'api' },
      query: undefined,
    })
  })

  it('uses the group route name when the slug is a group', () => {
    setFleetGroupReader(
      () =>
        [
          {
            id: 'g1',
            name: 'api, web',
            slug: 'api-web',
            memberSlugs: ['api', 'web'],
            lastOpened: '',
          },
        ] satisfies FleetProjectGroup[],
    )
    expect(projectRouteFor('api-web', 'chats')).toEqual({
      name: 'group',
      params: { slug: 'api-web' },
      query: { section: 'chats' },
    })
  })
})
