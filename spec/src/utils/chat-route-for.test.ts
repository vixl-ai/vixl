import { beforeEach, describe, expect, it } from 'vitest'
import { setFleetGroupReader } from '@/utils/fleet-group-reader'
import chatRouteFor from '@/utils/chat-route-for'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import type { FleetProjectGroup } from '@/types/fleet/fleet-project-group'

describe('chat-route-for', () => {
  beforeEach(() => {
    setFleetGroupReader(() => [])
  })

  it('emits the home chat path for the home slug', () => {
    expect(chatRouteFor(HOME_CHAT_SLUG, 'c1')).toBe('/chat/c1')
  })

  it('emits the project chat path for a project slug', () => {
    expect(chatRouteFor('api', 'c1')).toBe('/project/api/chat/c1')
  })

  it('emits the group chat path when the slug is a group', () => {
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
    expect(chatRouteFor('api-web', 'c1')).toBe('/group/api-web/chat/c1')
    expect(chatRouteFor('api-web', 'c1', 'sub-1')).toBe(
      '/group/api-web/chat/c1/subagent/sub-1',
    )
  })
})
