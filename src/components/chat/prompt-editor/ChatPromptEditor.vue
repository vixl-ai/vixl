<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import Document from '@tiptap/extension-document'
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
import useSlashIndex from '@/composables/use-slash-index'
import createChatMentionExtension from '@/utils/chat-mention-extension'
import {
  plainTextFromEditor,
  plainTextToDoc,
  shouldApplyExternalText,
  splitOnShiftEnter,
} from '@/utils/chat-prompt-editor'
import contextMentionFromNode from '@/utils/context-mention-from-node'
import searchWorkspaceFiles from '@/utils/search-workspace-files'
import formatUnknownError from '@/utils/format-unknown-error'
import type { ContextMention } from '@/types/harness/context-mention'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { SlashIndexEntry } from '@/types/chat/slash-index-entry'

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class']
    placeholder?: string
    projectRoot?: string | null
    slashRoot?: string | null
    members?: HarnessWorkspaceMember[]
  }>(),
  {
    placeholder: '@ for context, / for commands',
    projectRoot: null,
    slashRoot: null,
    members: undefined,
  },
)

const { textInput, setTextInput, addFiles, files, removeFile } = usePromptInput()
const contextBudgetSync = useChatContextBudgetSync()
const chatPromptEditor = useChatPromptEditor()
const slashIndex = useSlashIndex(() => props.slashRoot ?? null)
const { readNativeClipboardImage } = useNativeClipboardImage()

const isComposing = ref(false)
const suggestionOpen = ref(false)
const applyingExternalText = ref(false)

let suggestionUnmount: (() => void) | null = null
let suggestionRenderer: VueRenderer | null = null

const fileSuggestionKey = new PluginKey('chatFileMention')
const skillSuggestionKey = new PluginKey('chatSkillMention')

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

const insertCapturedPasteText = (plainText: string): void => {
  const current = editor.value
  if (!current || !plainText) {
    return
  }

  const paragraphs = plainTextToDoc(plainText).content ?? []
  const chain = current.chain().focus()
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) {
      chain.splitBlock()
    }
    const nodes = paragraph.content
    if (nodes && nodes.length > 0) {
      chain.insertContent(nodes)
    }
  })
  chain.run()
}

const insertCapturedPasteHtml = (html: string): void => {
  const current = editor.value
  if (!current || !html) {
    return
  }
  current.chain().focus().insertContent(html).run()
}

const closeSuggestion = (): void => {
  suggestionUnmount?.()
  suggestionUnmount = null
  suggestionRenderer?.destroy()
  suggestionRenderer = null
  suggestionOpen.value = false
}

const handleNativeClipboardImagePaste = async (): Promise<boolean> => {
  try {
    const file = await readNativeClipboardImage()
    if (!file) {
      return false
    }
    addFiles([file])
    return true
  } catch (error) {
    toast.error('Could not read image from clipboard', {
      description: formatUnknownError(error),
    })
    throw error
  }
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

const slashSuggestionListProps = (suggestionProps: {
  query: string
  items: unknown[]
  loading: boolean
  command: (attrs: ReturnType<typeof contextMentionFromNode.toAttrs>) => void
}) => ({
  query: String(suggestionProps.query ?? ''),
  items: suggestionProps.items.filter((item): item is SlashIndexEntry => {
    if (!item || typeof item !== 'object') {
      return false
    }
    const record = item as { kind?: unknown; name?: unknown }
    return (
      (record.kind === 'skill' || record.kind === 'agent') &&
      typeof record.name === 'string'
    )
  }),
  loading: Boolean(suggestionProps.loading),
  command: (mention: ContextMention) => {
    suggestionProps.command(contextMentionFromNode.toAttrs(mention))
  },
})

const createSuggestionRender = (
  listComponent: typeof ChatMentionSuggestionList | typeof ChatSkillSuggestionList,
  toListProps: typeof fileSuggestionListProps | typeof slashSuggestionListProps,
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
        return await searchWorkspaceFiles(
          props.projectRoot,
          query,
          undefined,
          props.members,
        )
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
    items: ({ query }) => slashIndex.filterEntries(query),
    render: createSuggestionRender(
      ChatSkillSuggestionList,
      slashSuggestionListProps,
    ) as never,
  },
])

const editor = useEditor({
  extensions: [
    Document,
    Paragraph,
    Text,
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
      const currentEditor = editor.value
      if (currentEditor && splitOnShiftEnter(currentEditor, event, isComposing.value)) {
        return true
      }

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
      try {
        const clipboardData = event.clipboardData
        const clipboardItems = clipboardData?.items
        const plainText = clipboardData?.getData('text/plain') ?? ''
        const htmlText = clipboardData?.getData('text/html') ?? ''

        const fileKindItems = clipboardItems
          ? Array.from(clipboardItems).filter((item) => item.kind === 'file')
          : []

        let pastedFiles: File[] = []

        if (fileKindItems.length > 0) {
          event.preventDefault()
          for (const item of fileKindItems) {
            const file = item.getAsFile()
            if (file) {
              pastedFiles.push(file)
            }
          }
        }

        if (pastedFiles.length === 0) {
          pastedFiles = Array.from(clipboardData?.files ?? [])
          if (pastedFiles.length > 0 && fileKindItems.length === 0) {
            event.preventDefault()
          }
        }

        const usableFiles = pastedFiles.filter((file) => file.size > 0)
        if (usableFiles.length > 0) {
          addFiles(usableFiles)
          return true
        }

        const hadClipboardFiles = (clipboardData?.files.length ?? 0) > 0
        if (fileKindItems.length > 0 || hadClipboardFiles) {
          handleNativeClipboardImagePaste()
            .then((added) => {
              if (!added) {
                insertCapturedPasteText(plainText)
                if (!plainText) {
                  toast.error('Could not read image from clipboard', {
                    description: 'The clipboard item could not be converted to a file',
                  })
                }
              }
            })
            .catch(() => {
              // helper already toasted unexpected clipboard errors
              insertCapturedPasteText(plainText)
              return
            })
          return true
        }

        const stringKindItems = clipboardItems
          ? Array.from(clipboardItems).filter((item) => item.kind === 'string')
          : []
        if (stringKindItems.length === 0) {
          event.preventDefault()
          handleNativeClipboardImagePaste()
            .then((added) => {
              if (!added) {
                insertCapturedPasteText(plainText)
              }
            })
            .catch(() => {
              // helper already toasted unexpected clipboard errors
              insertCapturedPasteText(plainText)
              return
            })
          return true
        }

        const clipboardHasImageHtml = htmlText.toLowerCase().includes('<img')
        if (!clipboardHasImageHtml && (plainText || htmlText)) {
          return false
        }

        event.preventDefault()
        handleNativeClipboardImagePaste()
          .then((added) => {
            if (added) {
              // Insert the text only when it is real accompanying content, not a
              // markup fragment (image URL or alt text) already inside the HTML.
              const isMarkupFragment = plainText.trim().length > 0 && htmlText.includes(plainText.trim())
              if (plainText.trim().length > 0 && !isMarkupFragment) {
                insertCapturedPasteText(plainText)
              }
              return
            }
            if (plainText) {
              insertCapturedPasteText(plainText)
            } else {
              insertCapturedPasteHtml(htmlText)
            }
          })
          .catch(() => {
            // helper already toasted unexpected clipboard errors
            if (plainText) {
              insertCapturedPasteText(plainText)
            } else {
              insertCapturedPasteHtml(htmlText)
            }
            return
          })
        return true
      } catch (error) {
        toast.error('Paste failed', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        return false
      }
    },
  },
  onUpdate: ({ editor: current }) => {
    if (applyingExternalText.value) {
      return
    }
    const nextText = plainTextFromEditor(current)
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
    const editorText = plainTextFromEditor(current)
    if (!shouldApplyExternalText(editorText, value)) {
      return
    }
    applyingExternalText.value = true
    try {
      current.commands.setContent(plainTextToDoc(value), { emitUpdate: false })
      contextBudgetSync.setDraftMentions([])
    } finally {
      applyingExternalText.value = false
    }
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
