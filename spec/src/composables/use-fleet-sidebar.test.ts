import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockTauriEvent } from '../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import type { ChatMeta } from '@/types/chat/chat-meta'

const listProjectChats = vi.hoisted(
  () => vi.fn<(slug: string) => Promise<ChatMeta[]>>(async () => []),
)

type FleetProjectStub = {
  id: string
  slug: string
  name: string
  rootPath?: string
  lastOpened?: string
  worktree?: { parentId: string; branch: string; managed: boolean }
}

type FleetGroupStub = {
  id: string
  slug: string
  name: string
  memberSlugs: string[]
}

const fleetHandles = vi.hoisted(() => ({
  projects: undefined as { value: FleetProjectStub[] } | undefined,
  groups: undefined as { value: FleetGroupStub[] } | undefined,
  activeProjectId: undefined as { value: string | null } | undefined,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@tauri-apps/api/event', () => mockTauriEvent())

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    isTauri: () => false,
    listPinnedChats: vi.fn<() => Promise<unknown[]>>(async () => []),
  }),
)

vi.mock('@/composables/use-fleet-registry', async () => {
  const { ref } = await import('vue')
  const projects = ref<FleetProjectStub[]>([])
  const groups = ref<FleetGroupStub[]>([])
  const activeProjectId = ref<string | null>(null)
  fleetHandles.projects = projects
  fleetHandles.groups = groups
  fleetHandles.activeProjectId = activeProjectId
  return {
    default: () => ({
      projects,
      groups,
      activeProjectId,
      refresh: vi.fn<() => Promise<void>>(async () => undefined),
    }),
  }
})

vi.mock('@/composables/use-chat-store', () => ({
  default: () => ({
    listProjectChats: (slug: string) => listProjectChats(slug),
  }),
}))

import useFleetSidebar, { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import {
  revealedProjectSlug,
  revealFleetProject,
} from '@/composables/fleet-project-reveal'

const fleetProjects = fleetHandles.projects!
const fleetGroups = fleetHandles.groups!
const activeProjectId = fleetHandles.activeProjectId!

const makeChat = (
  overrides: Pick<ChatMeta, 'id' | 'title' | 'projectSlug' | 'updatedAt'> &
    Partial<ChatMeta>,
): ChatMeta => ({
  projectRoot: '/tmp/root',
  mode: 'agent',
  model: 'test-model',
  status: 'idle',
  createdAt: overrides.createdAt ?? overrides.updatedAt,
  forkedFrom: null,
  pinned: false,
  pinnedAt: null,
  ...overrides,
})

const seedSidebar = async (
  chatsBySlug: Record<string, ChatMeta[]>,
): Promise<ReturnType<typeof useFleetSidebar>> => {
  listProjectChats.mockImplementation(async (slug: string) => chatsBySlug[slug] ?? [])
  const sidebar = useFleetSidebar()
  await sidebar.refreshChats()
  return sidebar
}

const activitySlugs = (sidebar: ReturnType<typeof useFleetSidebar>): string[] =>
  sidebar.activityItems.value.map((item) =>
    item.kind === 'home' ? 'home' : item.project.slug,
  )

describe('use-fleet-sidebar activityItems', () => {
  beforeEach(() => {
    listProjectChats.mockReset()
    listProjectChats.mockResolvedValue([])
    fleetProjects.value = [
      { id: 'proj-1', slug: 'alpha', name: 'Alpha' },
    ]
    fleetGroups.value = []
    activeProjectId.value = null
    revealedProjectSlug.value = null
  })

  it('emits exactly one home item when home chats exist', async () => {
    const sidebar = await seedSidebar({
      alpha: [
        makeChat({
          id: 'p1',
          title: 'Project chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [
        makeChat({
          id: 'h1',
          title: 'First home',
          projectSlug: HOME_CHAT_SLUG,
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        makeChat({
          id: 'h2',
          title: 'Second home',
          projectSlug: HOME_CHAT_SLUG,
          updatedAt: '2026-01-03T00:00:00.000Z',
          pinned: true,
        }),
      ],
    })

    const homeItems = sidebar.activityItems.value.filter((item) => item.kind === 'home')
    expect(homeItems).toHaveLength(1)
    expect(homeItems[0]?.chats.map((chat) => chat.id)).toEqual(['h1', 'h2'])
    expect(homeItems[0]?.chats).toEqual([
      expect.objectContaining({
        id: 'h1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        pinned: false,
      }),
      expect.objectContaining({
        id: 'h2',
        updatedAt: '2026-01-03T00:00:00.000Z',
        pinned: true,
      }),
    ])
  })

  it('omits the home item when there are no home chats', async () => {
    const sidebar = await seedSidebar({
      alpha: [
        makeChat({
          id: 'p1',
          title: 'Project chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [],
    })

    expect(sidebar.activityItems.value.some((item) => item.kind === 'home')).toBe(false)
  })

  it('sorts the home item against projects by newest chat updatedAt', async () => {
    fleetProjects.value = [
      { id: 'proj-1', slug: 'alpha', name: 'Alpha' },
      { id: 'proj-2', slug: 'beta', name: 'Beta' },
    ]

    const sidebar = await seedSidebar({
      alpha: [
        makeChat({
          id: 'a1',
          title: 'Alpha chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      beta: [
        makeChat({
          id: 'b1',
          title: 'Beta chat',
          projectSlug: 'beta',
          updatedAt: '2026-01-04T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [
        makeChat({
          id: 'h1',
          title: 'Home chat',
          projectSlug: HOME_CHAT_SLUG,
          updatedAt: '2026-01-03T00:00:00.000Z',
        }),
      ],
    })

    expect(
      sidebar.activityItems.value.map((item) =>
        item.kind === 'home' ? 'home' : item.project.slug,
      ),
    ).toEqual(['beta', 'home', 'alpha'])
  })

  it('pins a revealed project above newer chats after a full chat refresh', async () => {
    fleetProjects.value = [
      { id: 'proj-1', slug: 'alpha', name: 'Alpha' },
      { id: 'proj-2', slug: 'beta', name: 'Beta' },
    ]

    const sidebar = await seedSidebar({
      alpha: [
        makeChat({
          id: 'a1',
          title: 'Alpha chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      beta: [
        makeChat({
          id: 'b1',
          title: 'Beta chat',
          projectSlug: 'beta',
          updatedAt: '2026-01-04T00:00:00.000Z',
        }),
      ],
    })

    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])

    revealFleetProject('alpha')

    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])

    await sidebar.refreshChats()

    expect(activitySlugs(sidebar)).toEqual(['alpha', 'beta'])

    revealedProjectSlug.value = null

    expect(activitySlugs(sidebar)).toEqual(['alpha', 'beta'])

    await sidebar.refreshChats()

    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])
  })

  it('opens an active project only after its chats are loaded', async () => {
    activeProjectId.value = 'proj-new'
    fleetProjects.value = [
      { id: 'proj-new', slug: 'not-loaded-yet', name: 'New' },
    ]
    const sidebar = useFleetSidebar()
    expect(sidebar.sidebarProjects.value[0]?.defaultExpanded).toBe(false)
    await sidebar.refreshChats()
    expect(sidebar.sidebarProjects.value[0]?.defaultExpanded).toBe(true)
  })

  it('sets home item updatedAt to the max of its chats', async () => {
    const sidebar = await seedSidebar({
      [HOME_CHAT_SLUG]: [
        makeChat({
          id: 'h-old',
          title: 'Older home',
          projectSlug: HOME_CHAT_SLUG,
          updatedAt: '2026-01-01T08:00:00.000Z',
        }),
        makeChat({
          id: 'h-new',
          title: 'Newer home',
          projectSlug: HOME_CHAT_SLUG,
          updatedAt: '2026-01-05T12:00:00.000Z',
        }),
        makeChat({
          id: 'h-mid',
          title: 'Mid home',
          projectSlug: HOME_CHAT_SLUG,
          updatedAt: '2026-01-03T00:00:00.000Z',
        }),
      ],
    })

    const homeItem = sidebar.activityItems.value.find((item) => item.kind === 'home')
    expect(homeItem?.updatedAt).toBe('2026-01-05T12:00:00.000Z')
  })

  it('includes group rows with chats keyed by group slug', async () => {
    fleetGroups.value = [
      {
        id: 'grp-1',
        slug: 'api-web',
        name: 'api, web',
        memberSlugs: ['alpha', 'beta'],
      },
    ]

    const sidebar = await seedSidebar({
      alpha: [
        makeChat({
          id: 'a1',
          title: 'Alpha chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      'api-web': [
        makeChat({
          id: 'g1',
          title: 'Group chat',
          projectSlug: 'api-web',
          updatedAt: '2026-01-06T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [],
    })

    const groupRow = sidebar.sidebarProjects.value.find((item) => item.slug === 'api-web')
    expect(groupRow?.kind).toBe('group')
    expect(groupRow?.displayName).toBe('api, web')
    expect(groupRow?.chats.map((chat) => chat.id)).toEqual(['g1'])
    expect(activitySlugs(sidebar)).toEqual(['api-web', 'alpha'])
  })

  it('keeps project order when a slug refresh makes an older project newer', async () => {
    fleetProjects.value = [
      { id: 'proj-1', slug: 'alpha', name: 'Alpha' },
      { id: 'proj-2', slug: 'beta', name: 'Beta' },
    ]
    const chats: Record<string, ChatMeta[]> = {
      alpha: [
        makeChat({
          id: 'a1',
          title: 'Alpha chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      beta: [
        makeChat({
          id: 'b1',
          title: 'Beta chat',
          projectSlug: 'beta',
          updatedAt: '2026-01-04T00:00:00.000Z',
        }),
      ],
    }
    const sidebar = await seedSidebar(chats)
    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])

    chats.alpha = [
      makeChat({
        id: 'a1',
        title: 'Alpha streaming',
        projectSlug: 'alpha',
        updatedAt: '2026-01-09T00:00:00.000Z',
      }),
    ]
    await sidebar.refreshSlug('alpha')
    await sidebar.refreshSlug('alpha')

    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])
    const alpha = sidebar.activityItems.value.find(
      (item) => item.kind === 'project' && item.project.slug === 'alpha',
    )
    expect(alpha?.updatedAt).toBe('2026-01-09T00:00:00.000Z')
    expect(alpha?.kind === 'project' ? alpha.project.chats.map((chat) => chat.title) : []).toEqual(
      ['Alpha streaming'],
    )

    await refreshFleetSidebar()

    expect(activitySlugs(sidebar)).toEqual(['alpha', 'beta'])
  })

  it('appends home when home chats arrive from a slug refresh', async () => {
    fleetProjects.value = [
      { id: 'proj-1', slug: 'alpha', name: 'Alpha' },
      { id: 'proj-2', slug: 'beta', name: 'Beta' },
    ]
    const chats: Record<string, ChatMeta[]> = {
      alpha: [
        makeChat({
          id: 'a1',
          title: 'Alpha chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      beta: [
        makeChat({
          id: 'b1',
          title: 'Beta chat',
          projectSlug: 'beta',
          updatedAt: '2026-01-04T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [],
    }
    const sidebar = await seedSidebar(chats)
    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])

    chats[HOME_CHAT_SLUG] = [
      makeChat({
        id: 'h1',
        title: 'Home chat',
        projectSlug: HOME_CHAT_SLUG,
        updatedAt: '2026-01-09T00:00:00.000Z',
      }),
    ]
    await sidebar.refreshSlug(HOME_CHAT_SLUG)

    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha', 'home'])
    const home = sidebar.activityItems.value.find((item) => item.kind === 'home')
    expect(home?.updatedAt).toBe('2026-01-09T00:00:00.000Z')

    await sidebar.refreshChats()

    expect(activitySlugs(sidebar)).toEqual(['home', 'beta', 'alpha'])
  })

  it('sorts a newly added project by current updatedAt', async () => {
    fleetProjects.value = [
      { id: 'proj-1', slug: 'alpha', name: 'Alpha' },
      { id: 'proj-2', slug: 'beta', name: 'Beta' },
    ]
    const chats: Record<string, ChatMeta[]> = {
      alpha: [
        makeChat({
          id: 'a1',
          title: 'Alpha chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      beta: [
        makeChat({
          id: 'b1',
          title: 'Beta chat',
          projectSlug: 'beta',
          updatedAt: '2026-01-04T00:00:00.000Z',
        }),
      ],
    }
    const sidebar = await seedSidebar(chats)

    chats.alpha = [
      makeChat({
        id: 'a1',
        title: 'Alpha chat',
        projectSlug: 'alpha',
        updatedAt: '2026-01-08T00:00:00.000Z',
      }),
    ]
    await sidebar.refreshSlug('alpha')
    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])

    chats.gamma = [
      makeChat({
        id: 'g1',
        title: 'Gamma chat',
        projectSlug: 'gamma',
        updatedAt: '2026-01-09T00:00:00.000Z',
      }),
    ]
    await sidebar.refreshSlug('gamma')
    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])

    fleetProjects.value = [
      ...fleetProjects.value,
      { id: 'proj-3', slug: 'gamma', name: 'Gamma' },
    ]

    expect(activitySlugs(sidebar)).toEqual(['gamma', 'alpha', 'beta'])
  })

  it('drops a removed project and resorts the rest by current updatedAt', async () => {
    fleetProjects.value = [
      { id: 'proj-1', slug: 'alpha', name: 'Alpha' },
      { id: 'proj-2', slug: 'beta', name: 'Beta' },
      { id: 'proj-3', slug: 'gamma', name: 'Gamma' },
    ]
    const chats: Record<string, ChatMeta[]> = {
      alpha: [
        makeChat({
          id: 'a1',
          title: 'Alpha chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      beta: [
        makeChat({
          id: 'b1',
          title: 'Beta chat',
          projectSlug: 'beta',
          updatedAt: '2026-01-04T00:00:00.000Z',
        }),
      ],
      gamma: [
        makeChat({
          id: 'g1',
          title: 'Gamma chat',
          projectSlug: 'gamma',
          updatedAt: '2026-01-03T00:00:00.000Z',
        }),
      ],
    }
    const sidebar = await seedSidebar(chats)
    expect(activitySlugs(sidebar)).toEqual(['beta', 'gamma', 'alpha'])

    chats.alpha = [
      makeChat({
        id: 'a1',
        title: 'Alpha chat',
        projectSlug: 'alpha',
        updatedAt: '2026-01-09T00:00:00.000Z',
      }),
    ]
    await sidebar.refreshSlug('alpha')
    expect(activitySlugs(sidebar)).toEqual(['beta', 'gamma', 'alpha'])

    fleetProjects.value = fleetProjects.value.filter((project) => project.slug !== 'gamma')

    expect(activitySlugs(sidebar)).toEqual(['alpha', 'beta'])
  })

  it('does not reorder projects when a nested worktree is added', async () => {
    fleetProjects.value = [
      { id: 'proj-1', slug: 'alpha', name: 'Alpha' },
      { id: 'proj-2', slug: 'beta', name: 'Beta' },
    ]
    const chats: Record<string, ChatMeta[]> = {
      alpha: [
        makeChat({
          id: 'a1',
          title: 'Alpha chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      beta: [
        makeChat({
          id: 'b1',
          title: 'Beta chat',
          projectSlug: 'beta',
          updatedAt: '2026-01-04T00:00:00.000Z',
        }),
      ],
    }
    const sidebar = await seedSidebar(chats)

    chats.alpha = [
      makeChat({
        id: 'a1',
        title: 'Alpha chat',
        projectSlug: 'alpha',
        updatedAt: '2026-01-09T00:00:00.000Z',
      }),
    ]
    await sidebar.refreshSlug('alpha')
    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])

    fleetProjects.value = [
      ...fleetProjects.value,
      {
        id: 'proj-wt',
        slug: 'alpha-wt',
        name: 'wt',
        worktree: { parentId: 'proj-1', branch: 'vixl/wt', managed: true },
      },
    ]

    expect(activitySlugs(sidebar)).toEqual(['beta', 'alpha'])
    expect(sidebar.sidebarProjects.value.map((item) => item.slug)).toEqual(['alpha', 'beta'])
    expect(
      sidebar.sidebarProjects.value.find((item) => item.slug === 'alpha')?.worktrees?.[0]?.slug,
    ).toBe('alpha-wt')
  })
})

describe('use-fleet-sidebar worktree nesting', () => {
  beforeEach(() => {
    listProjectChats.mockReset()
    listProjectChats.mockResolvedValue([])
    fleetGroups.value = []
    activeProjectId.value = null
    revealedProjectSlug.value = null
  })

  it('nests worktree projects under the parent with chats, sorted by lastOpened desc', async () => {
    fleetProjects.value = [
      {
        id: 'proj-parent',
        slug: 'demo',
        name: 'Demo',
        rootPath: '/tmp/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'proj-wt-old',
        slug: 'demo-fix',
        name: 'fix',
        rootPath: '/tmp/worktrees/demo/fix',
        lastOpened: '2026-01-02T00:00:00.000Z',
        worktree: { parentId: 'proj-parent', branch: 'vixl/fix', managed: true },
      },
      {
        id: 'proj-wt-new',
        slug: 'demo-feature',
        name: 'feature',
        rootPath: '/tmp/worktrees/demo/feature',
        lastOpened: '2026-01-04T00:00:00.000Z',
        worktree: { parentId: 'proj-parent', branch: 'vixl/feature', managed: true },
      },
    ]

    const sidebar = await seedSidebar({
      demo: [
        makeChat({
          id: 'p1',
          title: 'Parent chat',
          projectSlug: 'demo',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      'demo-feature': [
        makeChat({
          id: 'w1',
          title: 'Feature chat',
          projectSlug: 'demo-feature',
          updatedAt: '2026-01-05T00:00:00.000Z',
          pinned: true,
        }),
      ],
      'demo-fix': [
        makeChat({
          id: 'w2',
          title: 'Fix chat',
          projectSlug: 'demo-fix',
          updatedAt: '2026-01-03T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [],
    })

    expect(sidebar.sidebarProjects.value.map((item) => item.slug)).toEqual(['demo'])
    const parent = sidebar.sidebarProjects.value[0]
    expect(parent?.worktrees?.map((item) => item.slug)).toEqual([
      'demo-feature',
      'demo-fix',
    ])
    expect(parent?.worktrees?.map((item) => item.displayName)).toEqual([
      'vixl/feature',
      'vixl/fix',
    ])
    expect(parent?.chats).toEqual([
      expect.objectContaining({
        id: 'p1',
        updatedAt: '2026-01-02T00:00:00.000Z',
        pinned: false,
      }),
    ])
    expect(parent?.worktrees?.[0]?.chats).toEqual([
      expect.objectContaining({
        id: 'w1',
        updatedAt: '2026-01-05T00:00:00.000Z',
        pinned: true,
      }),
    ])
    expect(parent?.worktrees?.[1]?.chats).toEqual([
      expect.objectContaining({
        id: 'w2',
        updatedAt: '2026-01-03T00:00:00.000Z',
        pinned: false,
      }),
    ])
    expect(parent?.worktrees?.[0]?.activityAt).toBe('2026-01-05T00:00:00.000Z')
    expect(parent?.worktrees?.[1]?.activityAt).toBe('2026-01-03T00:00:00.000Z')
    expect(
      sidebar.activityItems.value.map((item) =>
        item.kind === 'home' ? 'home' : item.project.slug,
      ),
    ).toEqual(['demo'])
  })

  it('sets worktree activityAt to the newest nested chat, not lastOpened', async () => {
    fleetProjects.value = [
      {
        id: 'proj-parent',
        slug: 'demo',
        name: 'Demo',
        rootPath: '/tmp/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'proj-wt-later',
        slug: 'demo-later',
        name: 'later',
        rootPath: '/tmp/worktrees/demo/later',
        lastOpened: '2026-01-10T00:00:00.000Z',
        worktree: { parentId: 'proj-parent', branch: 'vixl/later', managed: true },
      },
      {
        id: 'proj-wt-earlier',
        slug: 'demo-earlier',
        name: 'earlier',
        rootPath: '/tmp/worktrees/demo/earlier',
        lastOpened: '2026-01-08T00:00:00.000Z',
        worktree: { parentId: 'proj-parent', branch: 'vixl/earlier', managed: true },
      },
    ]

    const sidebar = await seedSidebar({
      demo: [
        makeChat({
          id: 'p1',
          title: 'Parent chat',
          projectSlug: 'demo',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      'demo-later': [
        makeChat({
          id: 'w-old',
          title: 'Older later chat',
          projectSlug: 'demo-later',
          updatedAt: '2026-01-03T00:00:00.000Z',
        }),
        makeChat({
          id: 'w-new',
          title: 'Newer later chat',
          projectSlug: 'demo-later',
          updatedAt: '2026-01-05T00:00:00.000Z',
        }),
      ],
      'demo-earlier': [
        makeChat({
          id: 'w-hot',
          title: 'Hot earlier chat',
          projectSlug: 'demo-earlier',
          updatedAt: '2026-01-09T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [],
    })

    const parent = sidebar.sidebarProjects.value[0]
    expect(parent?.worktrees?.map((item) => item.slug)).toEqual([
      'demo-later',
      'demo-earlier',
    ])
    expect(parent?.worktrees?.[0]?.activityAt).toBe('2026-01-05T00:00:00.000Z')
    expect(parent?.worktrees?.[1]?.activityAt).toBe('2026-01-09T00:00:00.000Z')
    expect(
      sidebar.activityItems.value.map((item) =>
        item.kind === 'home' ? 'home' : item.project.slug,
      ),
    ).toEqual(['demo'])
  })

  it('sets worktree activityAt from last user message, not a newer agent updatedAt', async () => {
    fleetProjects.value = [
      {
        id: 'proj-parent',
        slug: 'demo',
        name: 'Demo',
        rootPath: '/tmp/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'proj-wt',
        slug: 'demo-feature',
        name: 'feature',
        rootPath: '/tmp/worktrees/demo/feature',
        lastOpened: '2026-01-01T00:00:00.000Z',
        worktree: { parentId: 'proj-parent', branch: 'vixl/feature', managed: true },
      },
    ]

    const sidebar = await seedSidebar({
      demo: [
        makeChat({
          id: 'p1',
          title: 'Parent chat',
          projectSlug: 'demo',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      'demo-feature': [
        makeChat({
          id: 'w-old-user',
          title: 'Older user',
          projectSlug: 'demo-feature',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-20T00:00:00.000Z',
          lastUserMessageAt: '2026-01-03T00:00:00.000Z',
        }),
        makeChat({
          id: 'w-new-user',
          title: 'Newer user',
          projectSlug: 'demo-feature',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-09T00:00:00.000Z',
          lastUserMessageAt: '2026-01-08T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [],
    })

    const parent = sidebar.sidebarProjects.value[0]
    expect(parent?.worktrees?.[0]?.activityAt).toBe('2026-01-08T00:00:00.000Z')
    expect(
      sidebar.activityItems.value.map((item) =>
        item.kind === 'home' ? 'home' : item.project.slug,
      ),
    ).toEqual(['demo'])
  })

  it('sets worktree activityAt to lastOpened when the worktree has no chats', async () => {
    fleetProjects.value = [
      {
        id: 'proj-parent',
        slug: 'demo',
        name: 'Demo',
        rootPath: '/tmp/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'proj-wt',
        slug: 'demo-feature',
        name: 'feature',
        rootPath: '/tmp/worktrees/demo/feature',
        lastOpened: '2026-01-07T00:00:00.000Z',
        worktree: { parentId: 'proj-parent', branch: 'vixl/feature', managed: true },
      },
    ]

    const sidebar = await seedSidebar({
      demo: [
        makeChat({
          id: 'p1',
          title: 'Parent chat',
          projectSlug: 'demo',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      'demo-feature': [],
      [HOME_CHAT_SLUG]: [],
    })

    const parent = sidebar.sidebarProjects.value[0]
    expect(parent?.worktrees?.map((item) => item.slug)).toEqual(['demo-feature'])
    expect(parent?.worktrees?.[0]?.chats).toEqual([])
    expect(parent?.worktrees?.[0]?.activityAt).toBe('2026-01-07T00:00:00.000Z')
    expect(
      sidebar.activityItems.value.map((item) =>
        item.kind === 'home' ? 'home' : item.project.slug,
      ),
    ).toEqual(['demo'])
  })

  it('keeps an orphan worktree link as a top-level project', async () => {
    fleetProjects.value = [
      {
        id: 'proj-orphan',
        slug: 'orphan',
        name: 'Orphan',
        rootPath: '/tmp/orphan',
        lastOpened: '2026-01-01T00:00:00.000Z',
        worktree: { parentId: 'missing-parent', branch: 'vixl/orphan', managed: true },
      },
    ]

    const sidebar = await seedSidebar({
      orphan: [
        makeChat({
          id: 'o1',
          title: 'Orphan chat',
          projectSlug: 'orphan',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [],
    })

    expect(sidebar.sidebarProjects.value.map((item) => item.slug)).toEqual(['orphan'])
    expect(sidebar.sidebarProjects.value[0]?.displayName).toBe('Orphan')
    expect(sidebar.sidebarProjects.value[0]?.worktrees).toEqual([])
    expect(sidebar.sidebarProjects.value[0]?.chats.map((chat) => chat.id)).toEqual(['o1'])
  })

  it('leaves group rows unchanged when worktrees exist', async () => {
    fleetProjects.value = [
      {
        id: 'proj-parent',
        slug: 'alpha',
        name: 'Alpha',
        rootPath: '/tmp/alpha',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'proj-wt',
        slug: 'alpha-wt',
        name: 'wt',
        rootPath: '/tmp/worktrees/alpha/wt',
        lastOpened: '2026-01-02T00:00:00.000Z',
        worktree: { parentId: 'proj-parent', branch: 'vixl/wt', managed: true },
      },
    ]
    fleetGroups.value = [
      {
        id: 'grp-1',
        slug: 'api-web',
        name: 'api, web',
        memberSlugs: ['alpha', 'beta'],
      },
    ]

    const sidebar = await seedSidebar({
      alpha: [],
      'alpha-wt': [],
      'api-web': [
        makeChat({
          id: 'g1',
          title: 'Group chat',
          projectSlug: 'api-web',
          updatedAt: '2026-01-06T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [],
    })

    const groupRow = sidebar.sidebarProjects.value.find((item) => item.slug === 'api-web')
    expect(groupRow?.kind).toBe('group')
    expect(groupRow?.worktrees).toBeUndefined()
    expect(groupRow?.chats.map((chat) => chat.id)).toEqual(['g1'])
    expect(sidebar.sidebarProjects.value.map((item) => item.slug)).toEqual([
      'alpha',
      'api-web',
    ])
  })

  it('does not change top-level sort of non-worktree rows', async () => {
    fleetProjects.value = [
      {
        id: 'proj-1',
        slug: 'alpha',
        name: 'Alpha',
        rootPath: '/tmp/alpha',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'proj-2',
        slug: 'beta',
        name: 'Beta',
        rootPath: '/tmp/beta',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'proj-wt',
        slug: 'alpha-wt',
        name: 'wt',
        rootPath: '/tmp/worktrees/alpha/wt',
        lastOpened: '2026-01-08T00:00:00.000Z',
        worktree: { parentId: 'proj-1', branch: 'vixl/wt', managed: true },
      },
    ]

    const sidebar = await seedSidebar({
      alpha: [
        makeChat({
          id: 'a1',
          title: 'Alpha chat',
          projectSlug: 'alpha',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      beta: [
        makeChat({
          id: 'b1',
          title: 'Beta chat',
          projectSlug: 'beta',
          updatedAt: '2026-01-04T00:00:00.000Z',
        }),
      ],
      'alpha-wt': [
        makeChat({
          id: 'w1',
          title: 'Worktree chat',
          projectSlug: 'alpha-wt',
          updatedAt: '2026-01-09T00:00:00.000Z',
        }),
      ],
      [HOME_CHAT_SLUG]: [],
    })

    expect(
      sidebar.activityItems.value.map((item) =>
        item.kind === 'home' ? 'home' : item.project.slug,
      ),
    ).toEqual(['beta', 'alpha'])
    expect(
      sidebar.sidebarProjects.value.find((item) => item.slug === 'alpha')
        ?.worktrees?.[0]?.activityAt,
    ).toBe('2026-01-09T00:00:00.000Z')
  })
})
