import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref, shallowRef } from 'vue'
import { Collapsible } from '@/components/shadcn/ui/collapsible'
import { TooltipProvider } from '@/components/shadcn/ui/tooltip'
import VixlFileCreateHost from '@/components/settings/vixl-files/VixlFileCreateHost.vue'
import VixlFilesSection from '@/components/settings/sections/VixlFilesSection.vue'
import { HOME_WORKSPACE_ID } from '@/constants/home-chat'
import type { SettingsTab } from '@/composables/use-vixl-config'
import type { ProjectFileEntry } from '@/services/vixl/vixl-tauri'

const listVixlFiles = vi.hoisted(() =>
  vi.fn<() => Promise<ProjectFileEntry[]>>().mockResolvedValue([]),
)
const openEditor = vi.hoisted(() => vi.fn<(projectId: string, path: string) => Promise<void>>())
const openPlan = vi.hoisted(() =>
  vi.fn<(projectId: string, name: string, path: string, title: string) => Promise<void>>(),
)
const activeRootPath = vi.hoisted(() => ({ value: null as string | null }))
const fleetProjects = vi.hoisted(() => ({
  value: [] as Array<{ id: string; rootPath: string }>,
}))
const activeProjectId = vi.hoisted(() => ({ value: null as string | null }))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  listVixlFiles,
  fsMkdir: vi.fn<(...args: unknown[]) => Promise<void>>(),
  getVixlDir: vi.fn<(...args: unknown[]) => Promise<string>>(),
  revealInFolder: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('@/composables/use-vixl-config', () => ({
  default: () => ({
    activeRootPath,
  }),
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    projects: fleetProjects,
    activeProjectId,
  }),
}))

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    openEditor,
    openPlan,
  }),
}))

vi.mock('@/composables/use-start-vixl-files-chat', () => ({
  default: () => ({
    handleSelectChat: vi.fn<(...args: unknown[]) => void>(),
  }),
}))

vi.mock('@/composables/use-vixl-live-sync', () => ({
  vixlFileChangeToken: ref(0),
  lastVixlFileChange: shallowRef(null),
}))

const sectionProps = {
  tab: 'personal' as const,
  kind: 'rules' as const,
  title: 'Rules',
  emptyMessage: 'No rules',
  folderLabel: 'rules',
  collapsible: true,
}

const isCollapsibleOpen = (wrapper: VueWrapper): boolean => {
  const collapsible = wrapper.findComponent(Collapsible)
  const openProp = collapsible.props('open')
  if (typeof openProp === 'boolean') {
    return openProp
  }
  return wrapper.find('[data-icon="chevron-right"]').classes().includes('rotate-90')
}

const SectionHost = defineComponent({
  components: { TooltipProvider, VixlFilesSection },
  props: {
    tab: {
      type: String,
      default: 'personal',
    },
    collapsible: {
      type: Boolean,
      default: true,
    },
  },
  setup() {
    return { sectionProps }
  },
  template: `
    <TooltipProvider>
      <VixlFilesSection v-bind="sectionProps" :tab="tab" :collapsible="collapsible" />
    </TooltipProvider>
  `,
})

const mountSection = (props: { tab?: SettingsTab; collapsible?: boolean } = {}): VueWrapper =>
  mount(SectionHost, {
    props,
    global: {
      stubs: {
        VixlFileCreateHost: true,
      },
    },
  })

const resetSectionMocks = (): void => {
  listVixlFiles.mockReset()
  listVixlFiles.mockResolvedValue([])
  openEditor.mockReset()
  openPlan.mockReset()
  activeRootPath.value = null
  fleetProjects.value = []
  activeProjectId.value = null
}

describe('VixlFilesSection create host', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    resetSectionMocks()
  })

  it('keeps the create host open without expanding the collapsible', async () => {
    wrapper = mountSection()
    await nextTick()

    const createHost = wrapper.findComponent(VixlFileCreateHost)
    expect(createHost.exists()).toBe(true)
    expect(isCollapsibleOpen(wrapper)).toBe(false)
    expect(wrapper.find('[data-icon="chevron-right"]').classes()).not.toContain('rotate-90')

    const newRule = wrapper.find('button[aria-label="New rule"]')
    expect(newRule.exists()).toBe(true)
    await newRule.trigger('click')
    await nextTick()

    expect(wrapper.findComponent(VixlFileCreateHost).props('open')).toBe(true)
    expect(isCollapsibleOpen(wrapper)).toBe(false)
    expect(wrapper.find('[data-icon="chevron-right"]').classes()).not.toContain('rotate-90')
  })
})

describe('VixlFilesSection project id for editor', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    resetSectionMocks()
  })

  it('opens personal files against the home workspace id', async () => {
    listVixlFiles.mockResolvedValue([
      { name: 'rule.md', path: '/Users/test-home/.vixl/rules/rule.md' },
    ])
    activeProjectId.value = 'proj-1'
    wrapper = mountSection({ collapsible: false })
    await flushPromises()

    const openButton = wrapper.find('button[aria-label="Open in editor"]')
    expect(openButton.exists()).toBe(true)
    await openButton.trigger('click')
    await flushPromises()

    expect(openEditor).toHaveBeenCalledWith(
      HOME_WORKSPACE_ID,
      '/Users/test-home/.vixl/rules/rule.md',
    )
    expect(openPlan).not.toHaveBeenCalled()
  })

  it('opens project files against the matching fleet project', async () => {
    listVixlFiles.mockResolvedValue([{ name: 'rule.md', path: '/tmp/proj/.vixl/rules/rule.md' }])
    activeRootPath.value = '/tmp/proj'
    fleetProjects.value = [{ id: 'proj-1', rootPath: '/tmp/proj' }]
    activeProjectId.value = 'other-proj'
    wrapper = mountSection({ tab: 'project', collapsible: false })
    await flushPromises()

    const openButton = wrapper.find('button[aria-label="Open in editor"]')
    expect(openButton.exists()).toBe(true)
    await openButton.trigger('click')
    await flushPromises()

    expect(openEditor).toHaveBeenCalledWith('proj-1', '.vixl/rules/rule.md')
  })
})
