import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import WorktreeRow from '@/components/navigation/aside/left/WorktreeRow.vue'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'
import chatRouteFor from '@/utils/chat-route-for'

const push = vi.hoisted(
  () => vi.fn<(to: string) => Promise<void>>(async () => undefined),
)

const setActiveProject = vi.hoisted(
  () => vi.fn<(projectId: string) => Promise<void>>(async () => undefined),
)

const createNewChat = vi.hoisted(
  () =>
    vi.fn<
      (args: {
        projectSlug: string
        projectRoot: string
        mode: string
        model: string
      }) => Promise<{ id: string }>
    >(async () => ({ id: 'chat-1' })),
)

const resolveModelForRole = vi.hoisted(
  () => vi.fn<() => string | null>(() => 'openai::gpt-4o'),
)

const refreshFleetSidebar = vi.hoisted(
  () => vi.fn<() => Promise<void>>(async () => undefined),
)

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {} }),
  useRouter: () => ({ push }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    setActiveProject,
  }),
}))

vi.mock('@/composables/use-chat-store', () => ({
  default: () => ({
    createNewChat,
  }),
}))

vi.mock('@/composables/use-vixl-config', () => ({
  default: () => ({
    effectiveSettings: { value: {} },
  }),
}))

vi.mock('@/services/models/resolve-model-for-role', () => ({
  default: () => resolveModelForRole(),
}))

vi.mock('@/composables/use-fleet-sidebar', () => ({
  refreshFleetSidebar,
}))

vi.mock('@/composables/use-git-status', () => ({
  default: () => ({
    entries: { value: [] },
  }),
}))

vi.mock('@/composables/remove-fleet-worktree', () => ({
  loadWorktreeRemovePreview: vi.fn<() => Promise<void>>(),
  confirmRemoveWorktree: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/components/navigation/aside/left/ChatListItem.vue', () => ({
  default: {
    name: 'ChatListItem',
    props: ['chat', 'projectSlug'],
    template: '<div class="chat-list-item" :data-chat-id="chat.id">{{ chat.title }}</div>',
  },
}))

vi.mock('@/components/workbench/FileTreeGitLetter.vue', () => ({
  default: {
    name: 'FileTreeGitLetter',
    template: '<span />',
  },
}))

const project: FleetSidebarProject = {
  id: 'wt-1',
  slug: 'demo-feature',
  displayName: 'feature',
  rootPath: '/tmp/worktrees/demo/feature',
  worktree: {
    parentId: 'parent-1',
    branch: 'feature',
    managed: true,
  },
  chats: [{ id: 'existing-1', title: 'Existing chat', status: 'idle' }],
}

const mountRow = (): VueWrapper =>
  mount(WorktreeRow, {
    props: {
      project,
      parentRootPath: '/tmp/demo',
    },
    global: {
      stubs: {
        SidebarMenuButton: { template: '<button type="button"><slot /></button>' },
        SidebarMenuAction: { template: '<div><slot /></div>' },
        SidebarMenuSub: { template: '<ul><slot /></ul>' },
        SidebarMenuSubItem: { template: '<li><slot /></li>' },
        CollapsibleContent: { template: '<div><slot /></div>' },
        CollapsibleTrigger: { template: '<div><slot /></div>' },
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div />' },
        ContextMenu: { template: '<div><slot /></div>' },
        ContextMenuTrigger: { template: '<div><slot /></div>' },
        ContextMenuContent: { template: '<div><slot /></div>' },
        ContextMenuItem: { template: '<div><slot /></div>' },
        AlertDialog: { template: '<div />' },
        GitBranch: true,
        Plus: true,
        FolderCog: true,
        Trash2: true,
      },
    },
  })

describe('WorktreeRow', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    push.mockClear()
    setActiveProject.mockClear()
    createNewChat.mockClear()
    resolveModelForRole.mockClear()
    refreshFleetSidebar.mockClear()
    resolveModelForRole.mockReturnValue('openai::gpt-4o')
    createNewChat.mockResolvedValue({ id: 'chat-1' })
    useProjectsExpansion().expansionMode.value = 'natural'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('starts a chat in the worktree when the plus button is clicked', async () => {
    wrapper = mountRow()

    await wrapper.get('[aria-label="New chat in feature"]').trigger('click')
    await flushPromises()

    expect(setActiveProject).toHaveBeenCalledWith('wt-1')
    expect(createNewChat).toHaveBeenCalledWith({
      projectSlug: 'demo-feature',
      projectRoot: '/tmp/worktrees/demo/feature',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })
    expect(push).toHaveBeenCalledWith(chatRouteFor('demo-feature', 'chat-1'))
  })
})
