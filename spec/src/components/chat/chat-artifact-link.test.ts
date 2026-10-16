import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ChatArtifactLink from '@/components/chat/ChatArtifactLink.vue'
import { HOME_WORKSPACE_ID } from '@/constants/home-chat'
import type { ChatArtifact } from '@/types/chat/chat-artifact'
import openAtLine from '@/utils/open-at-line'

const routeState = vi.hoisted(() => ({
  name: 'home-chat' as string | symbol | undefined,
  params: { chatId: 'chat-1' } as Record<string, unknown>,
}))

type FleetProjectStub = {
  id: string
  slug: string
  name: string
  rootPath: string
}

type FleetGroupStub = {
  id: string
  name: string
  slug: string
  memberSlugs: string[]
  lastOpened: string
}

const fleetState = vi.hoisted(() => ({
  projects: { value: [] as FleetProjectStub[] },
  groups: { value: [] as FleetGroupStub[] },
  activeProjectId: { value: null as string | null },
}))

const openPlan = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: toastError,
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => fleetState,
}))

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    openPlan,
  }),
}))

vi.mock('@/utils/open-at-line', () => ({
  default: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

const planArtifact: ChatArtifact = {
  kind: 'plan',
  path: '.vixl/plans/home-plan/PLAN.md',
  label: 'home-plan',
}

const mountLink = (artifact: ChatArtifact = planArtifact): VueWrapper =>
  mount(ChatArtifactLink, {
    props: { artifact },
  })

describe('ChatArtifactLink home chat', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    openPlan.mockClear()
    toastError.mockClear()
    vi.mocked(openAtLine).mockReset()
    vi.mocked(openAtLine).mockResolvedValue(undefined)
    fleetState.projects.value = []
    fleetState.groups.value = []
    fleetState.activeProjectId.value = null
    routeState.name = 'home-chat'
    routeState.params = { chatId: 'chat-1' }
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('opens the plan with HOME_WORKSPACE_ID on home-chat', async () => {
    wrapper = mountLink()
    await wrapper.get('button').trigger('click')

    expect(toastError).not.toHaveBeenCalled()
    expect(openPlan).toHaveBeenCalledWith(
      HOME_WORKSPACE_ID,
      'home-plan',
      planArtifact.path,
      planArtifact.label,
    )
  })

  it('opens the plan with HOME_WORKSPACE_ID on home-chat-subagent', async () => {
    routeState.name = 'home-chat-subagent'
    wrapper = mountLink()
    await wrapper.get('button').trigger('click')

    expect(toastError).not.toHaveBeenCalled()
    expect(openPlan).toHaveBeenCalledWith(
      HOME_WORKSPACE_ID,
      'home-plan',
      planArtifact.path,
      planArtifact.label,
    )
  })

  it('toasts when a project chat cannot resolve a project id', async () => {
    routeState.name = 'project-chat'
    routeState.params = { slug: 'missing-project', chatId: 'chat-1' }
    wrapper = mountLink()
    await wrapper.get('button').trigger('click')

    expect(openPlan).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Project not found', {
      description: 'Could not resolve the active project for this chat.',
    })
  })
})

describe('ChatArtifactLink group chat', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    openPlan.mockClear()
    toastError.mockClear()
    vi.mocked(openAtLine).mockReset()
    vi.mocked(openAtLine).mockResolvedValue(undefined)
    routeState.name = 'project-chat'
    routeState.params = { slug: 'stack', chatId: 'chat-1' }
    fleetState.activeProjectId.value = 'proj-api'
    fleetState.projects.value = [
      { id: 'proj-api', slug: 'api', name: 'API', rootPath: '/tmp/api' },
      { id: 'proj-web', slug: 'web', name: 'Web', rootPath: '/tmp/web' },
    ]
    fleetState.groups.value = [
      {
        id: 'group-1',
        name: 'Stack',
        slug: 'stack',
        memberSlugs: ['api', 'web'],
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
    ]
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('opens a slug-prefixed file in the matching member project', async () => {
    wrapper = mountLink({
      kind: 'file',
      path: 'web/src/a.ts',
      startLine: 12,
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-web', 'src/a.ts', 12)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('opens an unprefixed file in the primary project', async () => {
    wrapper = mountLink({
      kind: 'file',
      path: 'src/a.ts',
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-api', 'src/a.ts', undefined)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('keeps prefix parsing when one group member is missing and toasts for that slug', async () => {
    fleetState.projects.value = [
      { id: 'proj-web', slug: 'web', name: 'Web', rootPath: '/tmp/web' },
    ]
    fleetState.activeProjectId.value = 'proj-web'
    wrapper = mountLink({
      kind: 'file',
      path: 'api/src/a.ts',
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(openAtLine).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Project not found', {
      description: 'Project api is no longer available.',
    })
  })

  it('toasts for an unprefixed file when the group primary is missing', async () => {
    fleetState.projects.value = [
      { id: 'proj-web', slug: 'web', name: 'Web', rootPath: '/tmp/web' },
    ]
    fleetState.activeProjectId.value = 'proj-web'
    wrapper = mountLink({
      kind: 'file',
      path: 'src/a.ts',
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(openAtLine).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Project not found', {
      description: 'Could not resolve the active project for this chat.',
    })
  })

  it('still opens a live member path when another group member is missing', async () => {
    fleetState.projects.value = [
      { id: 'proj-web', slug: 'web', name: 'Web', rootPath: '/tmp/web' },
    ]
    fleetState.activeProjectId.value = 'proj-web'
    wrapper = mountLink({
      kind: 'file',
      path: 'web/src/a.ts',
      startLine: 4,
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-web', 'src/a.ts', 4)
    expect(toastError).not.toHaveBeenCalled()
  })
})
