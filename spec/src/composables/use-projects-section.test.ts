import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FleetSidebarActivityItem } from '@/composables/use-fleet-sidebar'
import type { FleetSidebarChat } from '@/types/fleet/fleet-sidebar-chat'

const activityItems = vi.hoisted(() => ({
  value: [] as FleetSidebarActivityItem[],
}))

const sidebarProjects = vi.hoisted(() => ({
  value: [] as unknown[],
}))

vi.mock('@/composables/use-fleet-sidebar', () => ({
  default: () => ({
    activityItems,
    sidebarProjects,
  }),
}))

import useProjectsSection from '@/composables/use-projects-section'

const homeChat = (
  id: string,
  title: string,
  status: FleetSidebarChat['status'] = 'idle',
): FleetSidebarChat => ({
  id,
  title,
  status,
})

const homeItem = (chats: FleetSidebarChat[]): FleetSidebarActivityItem => ({
  kind: 'home',
  chats,
  updatedAt: '2026-01-05T00:00:00.000Z',
})

const homeFrom = (
  items: FleetSidebarActivityItem[],
): Extract<FleetSidebarActivityItem, { kind: 'home' }> | undefined =>
  items.find((item): item is Extract<FleetSidebarActivityItem, { kind: 'home' }> =>
    item.kind === 'home',
  )

describe('use-projects-section filteredActivityItems', () => {
  beforeEach(() => {
    const section = useProjectsSection()
    section.searchQuery.value = ''
    section.runningOnly.value = false
    section.searchOpen.value = false
    activityItems.value = []
    sidebarProjects.value = []
  })

  it('filters home chats by title query', () => {
    activityItems.value = [
      homeItem([
        homeChat('h1', 'Alpha draft'),
        homeChat('h2', 'Beta draft'),
      ]),
    ]
    const { searchQuery, filteredActivityItems } = useProjectsSection()
    searchQuery.value = 'alpha'

    const home = homeFrom(filteredActivityItems.value)
    expect(home?.chats.map((chat) => chat.id)).toEqual(['h1'])
  })

  it('keeps all home chats when the query matches home', () => {
    activityItems.value = [
      homeItem([
        homeChat('h1', 'Alpha draft'),
        homeChat('h2', 'Beta draft'),
      ]),
    ]
    const { searchQuery, filteredActivityItems } = useProjectsSection()
    searchQuery.value = 'home'

    const home = homeFrom(filteredActivityItems.value)
    expect(home?.chats.map((chat) => chat.id)).toEqual(['h1', 'h2'])
  })

  it('filters home chats to running when running-only is on', () => {
    activityItems.value = [
      homeItem([
        homeChat('h1', 'Idle draft', 'idle'),
        homeChat('h2', 'Live draft', 'running'),
      ]),
    ]
    const { runningOnly, filteredActivityItems } = useProjectsSection()
    runningOnly.value = true

    const home = homeFrom(filteredActivityItems.value)
    expect(home?.chats.map((chat) => chat.id)).toEqual(['h2'])
  })

  it('drops the home item when filtering leaves no chats', () => {
    activityItems.value = [
      homeItem([
        homeChat('h1', 'Alpha draft'),
        homeChat('h2', 'Beta draft'),
      ]),
    ]
    const { searchQuery, filteredActivityItems } = useProjectsSection()
    searchQuery.value = 'zzzz'

    expect(homeFrom(filteredActivityItems.value)).toBeUndefined()
  })
})
