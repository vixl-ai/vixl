import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import type { FileUIPart } from 'ai'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenuTrigger,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input'
import ChatPromptInput from '@/components/chat/ChatPromptInput.vue'
import ChatGitBranchSelect from '@/components/chat/GitBranchSelect.vue'
import ChatPromptEditor from '@/components/chat/prompt-editor/ChatPromptEditor.vue'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import ModelOptionsRow from '@/components/models/options/ModelOptionsRow.vue'
import { Button } from '@/components/shadcn/ui/button'
import { DropdownMenuCheckboxItem, DropdownMenuItem } from '@/components/shadcn/ui/dropdown-menu'

const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const normalizeAttachmentFiles = vi.hoisted(
  () =>
    vi.fn<(files: FileUIPart[]) => Promise<FileUIPart[]>>(async (files) => files),
)
const resolveModelForRole = vi.hoisted(
  () => vi.fn<() => string | null>(() => 'openai::gpt-4o'),
)
const listConfiguredProviders = vi.hoisted(
  () => vi.fn<() => string[]>(() => ['openai']),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/utils/normalize-attachment-files', () => ({
  default: (files: FileUIPart[]) => normalizeAttachmentFiles(files),
}))

vi.mock('@/services/models/resolve-model-for-role', () => ({
  default: () => resolveModelForRole(),
}))

vi.mock('@/services/providers/list-configured-providers', () => ({
  default: () => listConfiguredProviders(),
}))

type FleetProject = {
  id: string
  name: string
  rootPath: string
}

const defaultFleetProject = (): FleetProject => ({
  id: 'p1',
  name: 'Proj',
  rootPath: '/tmp/proj',
})

const fleetState = vi.hoisted(() => ({
  projects: {
    value: [] as Array<{ id: string, name: string, slug?: string, rootPath: string }>,
  },
  groups: {
    value: [] as Array<{
      id: string
      name: string
      slug: string
      memberSlugs: string[]
    }>,
  },
  activeProject: {
    value: {
      id: 'p1',
      name: 'Proj',
      rootPath: '/tmp/proj',
    } as { id: string, name: string, rootPath: string } | null,
  },
  loaded: { value: true },
  setActiveProject: vi.fn<(id: string) => Promise<void>>(async () => undefined),
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    projects: fleetState.projects,
    groups: fleetState.groups,
    activeProject: fleetState.activeProject,
    loaded: fleetState.loaded,
    setActiveProject: fleetState.setActiveProject,
  }),
}))

vi.mock('@/composables/use-vixl-config', () => ({
  default: () => ({
    effectiveSettings: { value: {} },
    hydrated: { value: true },
  }),
}))

const gitState = vi.hoisted(() => ({
  isRepo: { value: false },
  setWorkspaceRoot: vi.fn<(root: string | null) => void>(),
}))

vi.mock('@/composables/use-git-branches', () => ({
  default: () => ({
    isRepo: gitState.isRepo,
    setWorkspaceRoot: gitState.setWorkspaceRoot,
  }),
}))

const chatMeta = vi.hoisted(() => ({
  value: null as { projectSlug?: string; projectRoot?: string } | null,
}))

vi.mock('@/composables/use-chat-store', () => ({
  default: () => ({
    editingMessageId: { value: null },
    meta: chatMeta,
    cancelEditMessage: vi.fn<() => void>(),
  }),
}))

vi.mock('@/composables/use-chat-context-budget-sync', () => ({
  default: () => ({
    draftMentions: { value: [] },
    setDraftSelection: vi.fn<(model: string, mode: string) => void>(),
    setDraftMentions: vi.fn<(mentions: unknown[]) => void>(),
  }),
}))

vi.mock('@/composables/use-chat-prompt-editor', () => ({
  default: () => ({
    editorRef: { value: null },
  }),
}))

vi.mock('@/composables/use-context-usage', () => ({
  default: () => ({
    free: { value: 0 },
  }),
}))

vi.mock('@/composables/use-mcp-servers', () => ({
  default: () => ({
    serverStates: { value: {} },
  }),
}))

vi.mock('@/composables/use-transparency', () => ({
  default: () => ({
    transparencyEnabled: { value: false },
  }),
}))

vi.mock('@/composables/use-root-effective-settings', () => ({
  default: () => ({
    settings: {
      value: {
        'agent.permissionLevel': 'allowlist',
      },
    },
  }),
}))

const imagePart = (): FileUIPart => ({
  type: 'file',
  url: 'data:image/png;base64,AAA',
  mediaType: 'image/png',
  filename: 'shot.png',
})

const promptInputContextMenuStub = {
  name: 'ChatPromptInputContextMenu',
  template: '<div><slot /></div>',
}

beforeEach(() => {
  chatMeta.value = null
  fleetState.projects.value = []
  fleetState.groups.value = []
  fleetState.activeProject.value = defaultFleetProject()
  fleetState.loaded.value = true
  fleetState.setActiveProject.mockClear()
  gitState.isRepo.value = false
  gitState.setWorkspaceRoot.mockClear()
})

const mountPromptInput = (props?: Record<string, unknown>) =>
  shallowMount(ChatPromptInput, {
    props,
    global: {
      renderStubDefaultSlot: true,
      stubs: {
        ChatPromptInputContextMenu: promptInputContextMenuStub,
      },
    },
  })

describe('ChatPromptInput handleSubmit', () => {
  beforeEach(() => {
    chatMeta.value = null
    toastError.mockClear()
    normalizeAttachmentFiles.mockReset()
    normalizeAttachmentFiles.mockImplementation(async (files) => files)
    resolveModelForRole.mockReturnValue('openai::gpt-4o')
    listConfiguredProviders.mockReturnValue(['openai'])
  })

  it('toasts and does not emit submit when attachment normalization fails', async () => {
    const attachError = new Error(
      'Image could not be compressed under the 3.75MB provider limit',
    )
    normalizeAttachmentFiles.mockRejectedValueOnce(attachError)

    const wrapper = mountPromptInput()
    await flushPromises()

    const promptProps = wrapper.findComponent(PromptInput).vm.$.vnode.props as {
      onSubmit: (message: { text: string, files: FileUIPart[] }) => Promise<void>
      onError: (err: { code: string, message: string }) => void
    }

    await expect(
      promptProps.onSubmit({
        text: 'caption',
        files: [imagePart()],
      }),
    ).rejects.toThrow(attachError)
    await flushPromises()

    expect(normalizeAttachmentFiles).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Could not attach image', {
      description: 'Image could not be compressed under the 3.75MB provider limit',
    })
    expect(wrapper.emitted('submit')).toBeUndefined()

    promptProps.onError({
      code: 'submit_error',
      message: attachError.message,
    })
    expect(toastError).toHaveBeenCalledTimes(1)

    promptProps.onError({
      code: 'submit_error',
      message: 'Could not send message',
    })
    expect(toastError).toHaveBeenCalledTimes(2)
    expect(toastError).toHaveBeenNthCalledWith(2, 'Could not send message')

    wrapper.unmount()
  })

  it('emits submit with normalized files when normalization succeeds', async () => {
    const normalized = {
      ...imagePart(),
      url: 'data:image/jpeg;base64,BBB',
      mediaType: 'image/jpeg',
      filename: 'shot.jpg',
    }
    normalizeAttachmentFiles.mockResolvedValueOnce([normalized])

    const wrapper = mountPromptInput()
    await flushPromises()

    await wrapper.findComponent(PromptInput).vm.$emit('submit', {
      text: 'caption',
      files: [imagePart()],
    })
    await flushPromises()

    expect(toastError).not.toHaveBeenCalled()
    expect(wrapper.emitted('submit')).toEqual([
      [
        expect.objectContaining({
          text: 'caption',
          files: [normalized],
        }),
      ],
    ])

    wrapper.unmount()
  })
})

describe('ChatPromptInput prompt roots', () => {
  beforeEach(() => {
    chatMeta.value = null
  })

  it('does not use the fleet project as slash root on a home chat', async () => {
    chatMeta.value = { projectSlug: HOME_CHAT_SLUG }
    const wrapper = mountPromptInput()
    await flushPromises()

    const editor = wrapper.findComponent(ChatPromptEditor)
    expect(editor.props('projectRoot')).toBeNull()
    expect(editor.props('slashRoot')).toBeNull()

    wrapper.unmount()
  })

  it('uses chat meta projectRoot as slash root on a home chat', async () => {
    chatMeta.value = {
      projectSlug: HOME_CHAT_SLUG,
      projectRoot: '/Users/aidan/home',
    }
    const wrapper = mountPromptInput()
    await flushPromises()

    const editor = wrapper.findComponent(ChatPromptEditor)
    expect(editor.props('projectRoot')).toBeNull()
    expect(editor.props('slashRoot')).toBe('/Users/aidan/home')

    wrapper.unmount()
  })

  it('passes a null slash root when Home is selected before the first send', async () => {
    fleetState.projects.value = [defaultFleetProject()]
    const wrapper = mountPromptInput({ showProjectSelect: true })
    await flushPromises()

    const editor = wrapper.findComponent(ChatPromptEditor)
    expect(editor.props('slashRoot')).toBe('/tmp/proj')
    expect(editor.props('projectRoot')).toBe('/tmp/proj')

    const projectPicker = wrapper
      .findAllComponents(Button)
      .find((button) => button.attributes('title') === 'Proj project')
    expect(projectPicker).toBeDefined()

    const homeItem = wrapper
      .findAllComponents(DropdownMenuItem)
      .find((item) => item.text().trim() === 'Home')
    expect(homeItem).toBeDefined()
    homeItem!.vm.$emit('select')
    await flushPromises()

    expect(editor.props('slashRoot')).toBeNull()
    expect(editor.props('projectRoot')).toBeNull()
    expect(wrapper.text()).not.toContain('No project')

    const homePicker = wrapper
      .findAllComponents(Button)
      .find((button) => button.text().includes('Home'))
    expect(homePicker).toBeDefined()
    expect(homePicker!.attributes('title')).toBe('Home')

    wrapper.unmount()
  })
})

describe('ChatPromptInput subagent composer props', () => {
  it('hides the stop button while streaming when hideStop is set', async () => {
    const wrapper = mountPromptInput({
      status: 'streaming',
      hideStop: true,
      allowSubmitWhileBusy: true,
    })
    await flushPromises()

    expect(wrapper.find('[aria-label="Stop generating"]').exists()).toBe(false)
    expect(wrapper.findComponent(PromptInputSubmit).exists()).toBe(true)

    wrapper.unmount()
  })

  it('shows the stop button while streaming by default', async () => {
    const wrapper = mountPromptInput({ status: 'streaming' })
    await flushPromises()

    expect(wrapper.find('[aria-label="Stop generating"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('hides the model picker when hideModel is set', async () => {
    const wrapper = mountPromptInput({ hideModel: true })
    await flushPromises()

    expect(wrapper.findComponent(ModelOptionsRow).exists()).toBe(false)
    expect(wrapper.find('span.max-w-56').exists()).toBe(false)

    wrapper.unmount()
  })

  it('renders the model picker by default', async () => {
    const wrapper = mountPromptInput()
    await flushPromises()

    expect(wrapper.findComponent(ModelOptionsRow).exists()).toBe(true)

    wrapper.unmount()
  })

  it('hides the mode picker when hideMode is set', async () => {
    const wrapper = mountPromptInput({ hideMode: true })
    await flushPromises()

    const modeTrigger = wrapper
      .findAllComponents(PromptInputActionMenuTrigger)
      .find((trigger) => trigger.attributes('title') === 'Agent mode')
    expect(modeTrigger).toBeUndefined()
    expect(wrapper.findComponent(PromptInputActionAddAttachments).exists()).toBe(true)

    wrapper.unmount()
  })

  it('renders the mode picker by default', async () => {
    const wrapper = mountPromptInput()
    await flushPromises()

    const modeTrigger = wrapper
      .findAllComponents(PromptInputActionMenuTrigger)
      .find((trigger) => trigger.attributes('title') === 'Agent mode')
    expect(modeTrigger).toBeDefined()

    wrapper.unmount()
  })
})

describe('ChatPromptInput project multiselect', () => {
  beforeEach(() => {
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
    fleetState.activeProject.value = {
      id: 'p1',
      name: 'api',
      rootPath: '/tmp/api',
    }
  })

  it('emits a single project workspace when one project is selected', async () => {
    const wrapper = mountPromptInput({ showProjectSelect: true })
    await flushPromises()

    await wrapper.findComponent(PromptInput).vm.$emit('submit', {
      text: 'hello',
      files: [],
    })
    await flushPromises()

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual(
      expect.objectContaining({
        text: 'hello',
        workspace: { kind: 'project', projectId: 'p1' },
      }),
    )

    wrapper.unmount()
  })

  it('shows a csv label and emits project ids when two projects are checked', async () => {
    const wrapper = mountPromptInput({ showProjectSelect: true })
    await flushPromises()

    const webItem = wrapper
      .findAllComponents(DropdownMenuCheckboxItem)
      .find((item) => item.text().includes('web'))
    expect(webItem).toBeDefined()
    await webItem!.vm.$emit('update:modelValue', true)
    await flushPromises()

    expect(wrapper.text()).toContain('api, web')

    await wrapper.findComponent(PromptInput).vm.$emit('submit', {
      text: 'multi',
      files: [],
    })
    await flushPromises()

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual(
      expect.objectContaining({
        workspace: { kind: 'projects', projectIds: ['p1', 'p2'] },
      }),
    )

    wrapper.unmount()
  })

  it('selecting a group emits a group workspace', async () => {
    const wrapper = mountPromptInput({ showProjectSelect: true })
    await flushPromises()

    const groupItem = wrapper
      .findAllComponents(DropdownMenuItem)
      .find((item) => item.text().includes('Group'))
    expect(groupItem).toBeDefined()
    await groupItem!.vm.$emit('select')
    await flushPromises()

    await wrapper.findComponent(PromptInput).vm.$emit('submit', {
      text: 'grouped',
      files: [],
    })
    await flushPromises()

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual(
      expect.objectContaining({
        workspace: { kind: 'group', groupId: 'g1' },
      }),
    )

    wrapper.unmount()
  })

  it('passes group members to the prompt editor for @ file search', async () => {
    const wrapper = mountPromptInput({ showProjectSelect: true })
    await flushPromises()

    const groupItem = wrapper
      .findAllComponents(DropdownMenuItem)
      .find((item) => item.text().includes('Group'))
    expect(groupItem).toBeDefined()
    await groupItem!.vm.$emit('select')
    await flushPromises()

    expect(wrapper.findComponent(ChatPromptEditor).props('members')).toEqual([
      { slug: 'api', name: 'api', rootPath: '/tmp/api' },
      { slug: 'web', name: 'web', rootPath: '/tmp/web' },
    ])

    wrapper.unmount()
  })

  it('passes group members from chat meta for an existing group chat', async () => {
    chatMeta.value = {
      projectSlug: 'api-web',
      projectRoot: '/tmp/api',
    }
    const wrapper = mountPromptInput()
    await flushPromises()

    expect(wrapper.findComponent(ChatPromptEditor).props('members')).toEqual([
      { slug: 'api', name: 'api', rootPath: '/tmp/api' },
      { slug: 'web', name: 'web', rootPath: '/tmp/web' },
    ])

    wrapper.unmount()
  })

  it('keeps a placeholder member when a group slug is missing from the fleet', async () => {
    chatMeta.value = {
      projectSlug: 'api-web',
      projectRoot: '/tmp/api',
    }
    fleetState.projects.value = [
      { id: 'p1', name: 'api', slug: 'api', rootPath: '/tmp/api' },
    ]
    const wrapper = mountPromptInput()
    await flushPromises()

    expect(wrapper.findComponent(ChatPromptEditor).props('members')).toEqual([
      { slug: 'api', name: 'api', rootPath: '/tmp/api' },
      { slug: 'web', name: 'web', rootPath: '' },
    ])

    wrapper.unmount()
  })
})

describe('ChatPromptInput git branch select', () => {
  beforeEach(() => {
    gitState.isRepo.value = true
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
    fleetState.activeProject.value = {
      id: 'p1',
      name: 'api',
      rootPath: '/tmp/api',
    }
  })

  it('hides the branch select when a group is selected', async () => {
    const wrapper = mountPromptInput({ showProjectSelect: true })
    await flushPromises()

    const groupItem = wrapper
      .findAllComponents(DropdownMenuItem)
      .find((item) => item.text().includes('Group'))
    expect(groupItem).toBeDefined()
    await groupItem!.vm.$emit('select')
    await flushPromises()

    expect(wrapper.findComponent(ChatGitBranchSelect).exists()).toBe(false)

    wrapper.unmount()
  })

  it('hides the branch select when two projects are selected', async () => {
    const wrapper = mountPromptInput({ showProjectSelect: true })
    await flushPromises()

    const webItem = wrapper
      .findAllComponents(DropdownMenuCheckboxItem)
      .find((item) => item.text().includes('web'))
    expect(webItem).toBeDefined()
    await webItem!.vm.$emit('update:modelValue', true)
    await flushPromises()

    expect(wrapper.findComponent(ChatGitBranchSelect).exists()).toBe(false)

    wrapper.unmount()
  })

  it('hides the branch select for an existing group chat', async () => {
    chatMeta.value = {
      projectSlug: 'api-web',
      projectRoot: '/tmp/api',
    }
    const wrapper = mountPromptInput()
    await flushPromises()

    expect(wrapper.findComponent(ChatGitBranchSelect).exists()).toBe(false)

    wrapper.unmount()
  })

  it('shows the branch select when one project is selected', async () => {
    const wrapper = mountPromptInput({ showProjectSelect: true })
    await flushPromises()

    expect(wrapper.findComponent(ChatGitBranchSelect).exists()).toBe(true)

    wrapper.unmount()
  })

  it('shows the branch select for an existing single-project chat', async () => {
    chatMeta.value = {
      projectSlug: 'api',
      projectRoot: '/tmp/api',
    }
    const wrapper = mountPromptInput()
    await flushPromises()

    expect(wrapper.findComponent(ChatGitBranchSelect).exists()).toBe(true)

    wrapper.unmount()
  })
})

