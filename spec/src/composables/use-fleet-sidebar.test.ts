import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockTauriEvent } from '../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import type { ChatMeta } from '@/types/chat/chat-meta'

const listProjectChats = vi.hoisted(
  () => vi.fn<(slug: string) => Promise<ChatMeta[]>>(async () => []),
)

const fleetProjects = vi.hoisted(() => ({
  value: [] as Array<{ id: string; slug: string; name: string }>,
}))

const activeProjectId = vi.hoisted(() => ({
  value: null as string | null,
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

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    projects: fleetProjects,
    activeProjectId,
    refresh: vi.fn<() => Promise<void>>(async () => undefined),
  }),
}))

vi.mock('@/composables/use-chat-store', () => ({
  default: () => ({
    listProjectChats: (slug: string) => listProjectChats(slug),
  }),
}))

import useFleetSidebar from '@/composables/use-fleet-sidebar'

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

describe('use-fleet-sidebar activityItems', () => {
  beforeEach(() => {
    listProjectChats.mockReset()
    listProjectChats.mockResolvedValue([])
    fleetProjects.value = [
      { id: 'proj-1', slug: 'alpha', name: 'Alpha' },
    ]
    activeProjectId.value = null
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
        }),
      ],
    })

    const homeItems = sidebar.activityItems.value.filter((item) => item.kind === 'home')
    expect(homeItems).toHaveLength(1)
    expect(homeItems[0]?.chats.map((chat) => chat.id)).toEqual(['h1', 'h2'])
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
})
