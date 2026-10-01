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
import ChatPromptEditor from '@/components/chat/prompt-editor/ChatPromptEditor.vue'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import ModelOptionsRow from '@/components/models/options/ModelOptionsRow.vue'

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

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    projects: { value: [] },
    activeProject: {
      value: {
        id: 'p1',
        name: 'Proj',
        rootPath: '/tmp/proj',
      },
    },
    loaded: { value: true },
    setActiveProject: vi.fn<(id: string) => Promise<void>>(),
  }),
}))

vi.mock('@/composables/use-vixl-config', () => ({
  default: () => ({
    effectiveSettings: { value: {} },
    hydrated: { value: true },
  }),
}))

vi.mock('@/composables/use-git-branches', () => ({
  default: () => ({
    isRepo: { value: false },
    setWorkspaceRoot: vi.fn<(root: string | null) => void>(),
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
