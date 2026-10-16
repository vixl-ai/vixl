import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import HomePage from '@/views/HomePage.vue'
import ChatPromptInput from '@/components/chat/ChatPromptInput.vue'
import { setFleetGroupReader } from '@/utils/fleet-group-reader'

const routerPush = vi.hoisted(() => vi.fn<(to: string) => Promise<void>>(async () => undefined))
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const createNewChat = vi.hoisted(
  () =>
    vi.fn<(args: { projectSlug: string; projectRoot: string }) => Promise<{ id: string; projectSlug: string }>>(
      async (args) => ({ id: 'chat-1', projectSlug: args.projectSlug }),
    ),
)
const addGroup = vi.hoisted(
  () =>
    vi.fn<(slugs: string[]) => Promise<{ id: string; slug: string; memberSlugs: string[] }>>(
      async (memberSlugs) => ({
        id: 'g1',
        slug: 'api-web',
        memberSlugs,
      }),
    ),
)
const setActiveProject = vi.hoisted(
  () => vi.fn<(id: string) => Promise<void>>(async () => undefined),
)
const refreshFleetSidebar = vi.hoisted(
  () => vi.fn<() => Promise<void>>(async () => undefined),
)

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
  loaded: { value: true },
  addGroup,
  setActiveProject,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPush,
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/composables/use-chat-store', () => ({
  default: () => ({
    clearChatState: vi.fn<() => void>(),
    createNewChat,
  }),
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => fleetState,
}))

vi.mock('@/composables/use-fleet-sidebar', () => ({
  refreshFleetSidebar,
}))

vi.mock('@/services/chat/pending-message', () => ({
  setPendingChatMessage: vi.fn<(...args: unknown[]) => void>(),
}))

vi.mock('@/services/vixl/vixl-tauri', async () => {
  const { mockVixlTauri } = await import('../test-utils/mocks/vixl-tauri')
  return mockVixlTauri({
    getUserHomeDir: async () => '/tmp/home',
  })
})

describe('HomePage handleSubmit', () => {
  beforeEach(() => {
    routerPush.mockClear()
    createNewChat.mockClear()
    addGroup.mockClear()
    setActiveProject.mockClear()
    refreshFleetSidebar.mockClear()
    toastError.mockClear()
    setFleetGroupReader(() => fleetState.groups.value as never)
  })

  const emitSubmit = async (workspace: unknown): Promise<void> => {
    const wrapper = shallowMount(HomePage)
    await wrapper.findComponent(ChatPromptInput).vm.$emit('submit', {
      text: 'hi',
      mode: 'agent',
      model: 'openai::gpt-4o',
      workspace,
      permissionLevel: 'allowlist',
    })
    await flushPromises()
    wrapper.unmount()
  }

  it('creates a project chat for a single project workspace', async () => {
    await emitSubmit({ kind: 'project', projectId: 'p1' })
    expect(createNewChat).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: 'api',
        projectRoot: '/tmp/api',
      }),
    )
    expect(routerPush).toHaveBeenCalledWith('/project/api/chat/chat-1')
  })

  it('creates a group chat when a group is selected', async () => {
    await emitSubmit({ kind: 'group', groupId: 'g1' })
    expect(addGroup).not.toHaveBeenCalled()
    expect(createNewChat).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: 'api-web',
        projectRoot: '/tmp/api',
      }),
    )
    expect(routerPush).toHaveBeenCalledWith('/group/api-web/chat/chat-1')
  })

  it('upserts a group then creates a chat for 2+ project ids', async () => {
    await emitSubmit({ kind: 'projects', projectIds: ['p1', 'p2'] })
    expect(addGroup).toHaveBeenCalledWith(['api', 'web'])
    expect(createNewChat).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: 'api-web',
        projectRoot: '/tmp/api',
      }),
    )
    expect(routerPush).toHaveBeenCalledWith('/group/api-web/chat/chat-1')
  })

  it('falls back to a project chat when only one selected project still resolves', async () => {
    await emitSubmit({ kind: 'projects', projectIds: ['p1', 'gone'] })
    expect(addGroup).not.toHaveBeenCalled()
    expect(createNewChat).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: 'api',
        projectRoot: '/tmp/api',
      }),
    )
    expect(routerPush).toHaveBeenCalledWith('/project/api/chat/chat-1')
  })

  it('toasts when no selected projects still resolve', async () => {
    await emitSubmit({ kind: 'projects', projectIds: ['gone', 'also-gone'] })
    expect(addGroup).not.toHaveBeenCalled()
    expect(createNewChat).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(
      'Could not start chat',
      expect.objectContaining({
        description: 'Selected projects are no longer available',
      }),
    )
  })
})
