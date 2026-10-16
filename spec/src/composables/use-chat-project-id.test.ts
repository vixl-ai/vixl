import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

const routeState = vi.hoisted(() => ({
  name: 'group-chat' as string,
  params: { slug: 'api-web', chatId: 'c1' } as Record<string, string>,
}))

const fleetState = vi.hoisted(() => ({
  projects: {
    value: [
      { id: 'p1', name: 'api', slug: 'api', rootPath: '/tmp/api' },
      { id: 'p2', name: 'web', slug: 'web', rootPath: '/tmp/web' },
    ],
  },
  groups: {
    value: [
      {
        id: 'g1',
        name: 'api, web',
        slug: 'api-web',
        memberSlugs: ['api', 'web'],
      },
    ],
  },
  activeProjectId: { value: 'p2' as string | null },
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => fleetState,
}))

import useChatProjectId from '@/composables/use-chat-project-id'
import { HOME_WORKSPACE_ID } from '@/constants/home-chat'

describe('use-chat-project-id', () => {
  beforeEach(() => {
    routeState.name = 'group-chat'
    routeState.params = { slug: 'api-web', chatId: 'c1' }
    fleetState.projects.value = [
      { id: 'p1', name: 'api', slug: 'api', rootPath: '/tmp/api' },
      { id: 'p2', name: 'web', slug: 'web', rootPath: '/tmp/web' },
    ]
    fleetState.groups.value = [
      {
        id: 'g1',
        name: 'api, web',
        slug: 'api-web',
        memberSlugs: ['api', 'web'],
      },
    ]
    fleetState.activeProjectId.value = 'p2'
  })

  it('maps a group chat slug to the primary member project id', () => {
    const projectId = useChatProjectId()
    expect(computed(() => projectId.value).value).toBe('p1')
  })

  it('returns the home workspace id on home chat routes', () => {
    routeState.name = 'home-chat'
    routeState.params = { chatId: 'c1' }
    const projectId = useChatProjectId()
    expect(projectId.value).toBe(HOME_WORKSPACE_ID)
  })

  it('returns null when the group primary is missing instead of the active project', () => {
    fleetState.projects.value = [
      { id: 'p2', name: 'web', slug: 'web', rootPath: '/tmp/web' },
    ]
    const projectId = useChatProjectId()
    expect(projectId.value).toBeNull()
  })
})
