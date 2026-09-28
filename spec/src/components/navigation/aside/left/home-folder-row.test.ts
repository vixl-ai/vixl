import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import HomeFolderRow from '@/components/navigation/aside/left/HomeFolderRow.vue'
import { Collapsible } from '@/components/shadcn/ui/collapsible'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import type { FleetSidebarChat } from '@/types/fleet/fleet-sidebar-chat'

const routeState = vi.hoisted(() => ({
  name: 'project-chat' as string | symbol | undefined,
}))

const startHomeChat = vi.hoisted(
  () => vi.fn<() => Promise<void>>(async () => undefined),
)

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
}))

vi.mock('@/composables/use-start-home-chat', async () => {
  const { ref } = await import('vue')
  return {
    default: () => ({
      startingChat: ref(false),
      startHomeChat,
    }),
  }
})

vi.mock('@/components/navigation/aside/left/ChatListItem.vue', () => ({
  default: {
    name: 'ChatListItem',
    props: ['chat', 'projectSlug'],
    template: '<div class="chat-list-item" :data-chat-id="chat.id">{{ chat.title }}</div>',
  },
}))

const chats: FleetSidebarChat[] = [
  { id: 'h1', title: 'First home', status: 'idle' },
  { id: 'h2', title: 'Second home', status: 'running' },
]

const mountRow = (): VueWrapper =>
  mount(HomeFolderRow, {
    props: { chats },
    global: {
      stubs: {
        SidebarMenuItem: { template: '<li><slot /></li>' },
        SidebarMenuButton: { template: '<button type="button"><slot /></button>' },
        SidebarMenuAction: { template: '<div><slot /></div>' },
        SidebarMenuSub: { template: '<ul><slot /></ul>' },
        SidebarMenuSubItem: { template: '<li><slot /></li>' },
        CollapsibleContent: { template: '<div><slot /></div>' },
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div />' },
        Folder: true,
        FolderOpen: true,
        Plus: true,
      },
    },
  })

describe('HomeFolderRow', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    startHomeChat.mockClear()
    routeState.name = 'project-chat'
    useProjectsExpansion().expansionMode.value = 'natural'
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('renders a list item per chat', () => {
    wrapper = mountRow()

    expect(wrapper.findAll('.chat-list-item')).toHaveLength(2)
    expect(wrapper.findAll('.chat-list-item').map((item) => item.attributes('data-chat-id'))).toEqual(
      ['h1', 'h2'],
    )
  })

  it('calls startHomeChat when the new home chat button is clicked', async () => {
    wrapper = mountRow()

    await wrapper.get('[aria-label="New home chat"]').trigger('click')

    expect(startHomeChat).toHaveBeenCalledTimes(1)
  })

  it('opens by default on a home-chat route', () => {
    routeState.name = 'home-chat'
    wrapper = mountRow()

    expect(wrapper.findComponent(Collapsible).props('open')).toBe(true)
  })

  it('does not open by default on another route', () => {
    routeState.name = 'project-chat'
    wrapper = mountRow()

    expect(wrapper.findComponent(Collapsible).props('open')).toBe(false)
  })
})
