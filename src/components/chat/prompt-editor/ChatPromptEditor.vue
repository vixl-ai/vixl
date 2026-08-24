<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Paragraph from '@tiptap/extension-paragraph'
import Placeholder from '@tiptap/extension-placeholder'
import Text from '@tiptap/extension-text'
import { EditorContent, useEditor, VueRenderer } from '@tiptap/vue-3'
import { PluginKey } from '@tiptap/pm/state'
import { cn } from '@/lib/utils'
import { usePromptInput } from '@/components/ai-elements/prompt-input/context'
import ChatMentionSuggestionList from '@/components/chat/prompt-editor/ChatMentionSuggestionList.vue'
import ChatSkillSuggestionList from '@/components/chat/prompt-editor/ChatSkillSuggestionList.vue'
import useChatContextBudgetSync from '@/composables/use-chat-context-budget-sync'
import useChatPromptEditor from '@/composables/use-chat-prompt-editor'
import { vixlFileChangeToken } from '@/composables/use-vixl-live-sync'
import createChatMentionExtension from '@/utils/chat-mention-extension'
import contextMentionFromNode from '@/utils/context-mention-from-node'
import searchWorkspaceFiles from '@/utils/search-workspace-files'
import formatUnknownError from '@/utils/format-unknown-error'
import { listSlashSkillIndex } from '@/services/skills/skill-registry'
import type { ContextMention } from '@/types/harness/context-mention'
import type { SkillIndexEntry } from '@/types/skills/skill'

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class']
    placeholder?: string
    projectRoot?: string | null
  }>(),
  {
    placeholder: '@ for context, / for commands',
    projectRoot: null,
  },
)

const { textInput, setTextInput, addFiles, files, removeFile } = usePromptInput()
const contextBudgetSync = useChatContextBudgetSync()
const chatPromptEditor = useChatPromptEditor()

const slashSkills = ref<SkillIndexEntry[]>([])

const refreshSlashSkills = async (): Promise<void> => {
  try {
    slashSkills.value = await listSlashSkillIndex(props.projectRoot ?? null)
  } catch (error) {
    toast.error('Failed to load skills', {
      description: formatUnknownError(error),
    })
  }
}

watch(
  [() => props.projectRoot, vixlFileChangeToken],
  () => {
    refreshSlashSkills().catch((error) => {
      toast.error('Failed to load skills', {
        description: formatUnknownError(error),
      })
    })
  },
  { immediate: true },
)

const isComposing = ref(false)
const suggestionOpen = ref(false)
const applyingExternalText = ref(false)

let suggestionUnmount: (() => void) | null = null
let suggestionRenderer: VueRenderer | null = null

const fileSuggestionKey = new PluginKey('chatFileMention')
const skillSuggestionKey = new PluginKey('chatSkillMention')

const plainTextToDoc = (text: string) => {
  const lines = text.split('\n')
  return {
    type: 'doc' as const,
    content: lines.map((line) => ({
      type: 'paragraph' as const,
      content: line.length > 0 ? [{ type: 'text' as const, text: line }] : [],
    })),
  }
}

const syncMentionsFromEditor = (): void => {
  const current = editor.value
  if (!current) {
    return
  }
  const next = contextMentionFromNode.collectFromEditor(current)
  const merged = contextMentionFromNode.mergePreservingContent(
    next,
    contextBudgetSync.draftMentions.value,
  )
  contextBudgetSync.setDraftMentions(merged)
}

const insertMention = (mention: ContextMention): void => {
  const current = editor.value
  if (!current) {
    return
  }
  const attrs = contextMentionFromNode.toAttrs(mention)
  current
    .chain()
    .focus()
    .insertContent([
      { type: 'mention', attrs },
      { type: 'text', text: ' ' },
    ])
    .run()
}

const insertPlainText = (text: string): void => {
  const current = editor.value
  if (!current) {
    return
  }
  const trimmed = text.trim()
  if (!trimmed) {
    return
  }
  const prefix = current.isEmpty ? '' : ' '
  current.chain().focus('end').insertContent(`${prefix}${trimmed} `).run()
}

const closeSuggestion = (): void => {
  suggestionUnmount?.()
  suggestionUnmount = null
  suggestionRenderer?.destroy()
  suggestionRenderer = null
  suggestionOpen.value = false
}

const fileSuggestionListProps = (suggestionProps: {
  query: string
  items: unknown[]
  loading: boolean
  command: (attrs: ReturnType<typeof contextMentionFromNode.toAttrs>) => void
}) => ({
  query: String(suggestionProps.query ?? ''),
  items: suggestionProps.items.filter((item): item is string => typeof item === 'string'),
  loading: Boolean(suggestionProps.loading),
  command: (mention: ContextMention) => {
    suggestionProps.command(contextMentionFromNode.toAttrs(mention))
  },
})

const skillSuggestionListProps = (suggestionProps: {
  query: string
  items: unknown[]
  loading: boolean
  command: (attrs: ReturnType<typeof contextMentionFromNode.toAttrs>) => void
}) => ({
  query: String(suggestionProps.query ?? ''),
  items: suggestionProps.items.filter(
    (item): item is SkillIndexEntry =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as SkillIndexEntry).name === 'string',
  ),
  loading: Boolean(suggestionProps.loading),
  command: (mention: ContextMention) => {
    suggestionProps.command(contextMentionFromNode.toAttrs(mention))
  },
})

const filterSkills = (query: string): SkillIndexEntry[] => {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return slashSkills.value
  }
  return slashSkills.value.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle),
  )
}

const createSuggestionRender = (
  listComponent: typeof ChatMentionSuggestionList | typeof ChatSkillSuggestionList,
  toListProps: typeof fileSuggestionListProps | typeof skillSuggestionListProps,
) => {
  return () => ({
    onStart: (suggestionProps: {
      editor: ConstructorParameters<typeof VueRenderer>[1]['editor']
      query: string
      items: unknown[]
      loading: boolean
      command: (attrs: ReturnType<typeof contextMentionFromNode.toAttrs>) => void
      mount: (element: HTMLElement) => () => void
    }) => {
      suggestionOpen.value = true
      suggestionRenderer = new VueRenderer(listComponent, {
        editor: suggestionProps.editor,
        props: toListProps(suggestionProps),
      })
      if (suggestionRenderer.element) {
        suggestionUnmount = suggestionProps.mount(suggestionRenderer.element as HTMLElement)
      }
    },
    onUpdate: (suggestionProps: {
      query: string
      items: unknown[]
      loading: boolean
      command: (attrs: ReturnType<typeof contextMentionFromNode.toAttrs>) => void
    }) => {
      suggestionRenderer?.updateProps(toListProps(suggestionProps))
    },
    onExit: () => {
      closeSuggestion()
    },
    onKeyDown: (keyProps: { event: KeyboardEvent }) => {
      if (keyProps.event.key === 'Escape') {
        closeSuggestion()
        return true
      }
      const listRef = suggestionRenderer?.ref as {
        onKeyDown?: (event: KeyboardEvent) => boolean
      } | null
      return Boolean(listRef?.onKeyDown?.(keyProps.event))
    },
  })
}

const mentionExtension = createChatMentionExtension([
  {
    pluginKey: fileSuggestionKey,
    char: '@',
    allowSpaces: false,
    debounce: 150,
    items: async ({ query }) => {
      try {
        return await searchWorkspaceFiles(props.projectRoot, query)
      } catch (error) {
        toast.error('Failed to search files', {
          description: formatUnknownError(error),
        })
        return []
      }
    },
    render: createSuggestionRender(
      ChatMentionSuggestionList,
      fileSuggestionListProps,
    ) as never,
  },
  {
    pluginKey: skillSuggestionKey,
    char: '/',
    allowSpaces: false,
    debounce: 100,
    items: ({ query }) => filterSkills(query),
    render: createSuggestionRender(
      ChatSkillSuggestionList,
      skillSuggestionListProps,
    ) as never,
  },
])

const editor = useEditor({
  extensions: [
    Document,
    Paragraph,
    Text,
    HardBreak,
    History,
    Placeholder.configure({
      placeholder: props.placeholder,
    }),
    mentionExtension,
  ],
  content: plainTextToDoc(textInput.value),
  editorProps: {
    attributes: {
      class: 'chat-prompt-editor-content max-h-28 min-h-10 px-3 py-2.5 text-sm',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': 'Chat prompt',
    },
    handleKeyDown: (_view, event) => {
      if (event.key === 'Enter' && !event.shiftKey && !isComposing.value && !suggestionOpen.value) {
        event.preventDefault()
        const target = editor.value?.view.dom
        const form = target?.closest('form')
        const submitButton = form?.querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement | null
        if (submitButton?.disabled) {
          return true
        }
        form?.requestSubmit()
        return true
      }

      if (
        event.key === 'Backspace' &&
        editor.value?.isEmpty &&
        files.value.length > 0
      ) {
        event.preventDefault()
        const lastFile = files.value[files.value.length - 1]
        if (lastFile) {
          removeFile(lastFile.id)
        }
        return true
      }

      return false
    },
    handlePaste: (_view, event) => {
      const clipboardItems = event.clipboardData?.items
      if (!clipboardItems) {
        return false
      }
      const pastedFiles: File[] = []
      for (const item of Array.from(clipboardItems)) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) {
            pastedFiles.push(file)
          }
        }
      }
      if (pastedFiles.length > 0) {
        event.preventDefault()
        addFiles(pastedFiles)
        return true
      }
      return false
    },
  },
  onUpdate: ({ editor: current }) => {
    if (applyingExternalText.value) {
      return
    }
    const nextText = current.getText({ blockSeparator: '\n' })
    if (nextText !== textInput.value) {
      setTextInput(nextText)
    }
    syncMentionsFromEditor()
  },
  onCreate: ({ editor: current }) => {
    chatPromptEditor.registerEditor(current, insertMention, insertPlainText)
  },
})

watch(editor, (current) => {
  chatPromptEditor.registerEditor(
    current ?? null,
    current ? insertMention : null,
    current ? insertPlainText : null,
  )
})

watch(
  () => textInput.value,
  (value) => {
    const current = editor.value
    if (!current) {
      return
    }
    const editorText = current.getText({ blockSeparator: '\n' })
    if (editorText === value) {
      return
    }
    applyingExternalText.value = true
    current.commands.setContent(plainTextToDoc(value), { emitUpdate: false })
    applyingExternalText.value = false
    contextBudgetSync.setDraftMentions([])
  },
)

watch(
  () => props.placeholder,
  (placeholder) => {
    const current = editor.value
    if (!current) {
      return
    }
    current.extensionManager.extensions.forEach((extension) => {
      if (extension.name === 'placeholder') {
        extension.options.placeholder = placeholder
      }
    })
    current.view.dispatch(current.state.tr)
  },
)

onBeforeUnmount(() => {
  closeSuggestion()
  chatPromptEditor.registerEditor(null, null, null)
  editor.value?.destroy()
})

const rootClass = computed(() =>
  cn(
    'chat-prompt-editor w-full min-w-0',
    props.class,
  ),
)
</script>

<template>
  <div
    :class="rootClass"
    @compositionstart="isComposing = true"
    @compositionend="isComposing = false"
  >
    <EditorContent :editor="editor" />
  </div>
</template>
