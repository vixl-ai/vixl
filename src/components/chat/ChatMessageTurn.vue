<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed } from 'vue'
import type { FileUIPart, UIMessage } from 'ai'
import { Attachment, AttachmentPreview, Attachments } from '@/components/ai-elements/attachments'
import type { AttachmentData } from '@/components/ai-elements/attachments'
import AiElementsMessageMessage from '@/components/ai-elements/message/Message.vue'
import AiElementsMessageMessageAction from '@/components/ai-elements/message/MessageAction.vue'
import AiElementsMessageMessageActions from '@/components/ai-elements/message/MessageActions.vue'
import AiElementsMessageMessageContent from '@/components/ai-elements/message/MessageContent.vue'
import useChatStore from '@/composables/use-chat-store'
import type { MentionHighlight } from '@/types/chat/mention-highlight'
import type { UserMessageMetadata } from '@/types/chat/user-message-metadata'
import formatModelLabelFromRef from '@/utils/format-model-label-from-ref'
import formatRelativeTime from '@/utils/format-relative-time'

const parseMentionHighlights = (value: unknown): MentionHighlight[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }
  const highlights: MentionHighlight[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    if (
      (record.kind !== 'mention' && record.kind !== 'skill') ||
      typeof record.token !== 'string'
    ) {
      continue
    }
    highlights.push({ kind: record.kind, token: record.token })
  }
  return highlights.length > 0 ? highlights : undefined
}

const props = defineProps<{
  message: UIMessage
  editable?: boolean
}>()

const chatStore = useChatStore()
const text = computed(() =>
  props.message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(''),
)

const fileAttachments = computed((): AttachmentData[] => {
  const attachments: AttachmentData[] = []
  props.message.parts.forEach((part, index) => {
    if (part.type !== 'file') {
      return
    }
    const filePart = part as FileUIPart
    attachments.push({
      id: `${props.message.id}-file-${index}`,
      type: 'file',
      url: filePart.url,
      mediaType: filePart.mediaType,
      filename: filePart.filename,
    })
  })
  return attachments
})

const metadata = computed((): UserMessageMetadata => {
  const value = props.message.metadata
  if (!value || typeof value !== 'object') {
    return {}
  }
  const record = value as Record<string, unknown>
  return {
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    model: typeof record.model === 'string' ? record.model : undefined,
    mentionHighlights: parseMentionHighlights(record.mentionHighlights),
  }
})

const modelLabel = computed(() => {
  const fromMeta = formatModelLabelFromRef(metadata.value.model)
  if (fromMeta) {
    return fromMeta
  }
  return formatModelLabelFromRef(chatStore.meta.value?.model)
})

const relativeTime = computed(() => {
  if (!metadata.value.createdAt) {
    return ''
  }
  return formatRelativeTime(metadata.value.createdAt)
})

const isEditing = computed(() => chatStore.editingMessageId.value === props.message.id)

const handleEditClick = (): void => {
  if (!props.editable || isEditing.value) {
    return
  }
  chatStore.beginEditMessage(props.message.id)
}
</script>

<template>
  <div class="flex w-full min-w-0 flex-col items-end gap-1.5">
    <Attachments v-if="fileAttachments.length > 0" variant="grid" class="max-w-[80%]">
      <Attachment v-for="file in fileAttachments" :key="file.id" :data="file">
        <AttachmentPreview />
      </Attachment>
    </Attachments>

    <AiElementsMessageMessage
      v-if="text.length > 0"
      from="user"
      class="group/user-message min-w-0 max-w-[80%]"
    >
      <AiElementsMessageMessageContent
        :class="[
          'max-w-full break-words whitespace-pre-wrap',
          isEditing ? 'ring-1 ring-inset ring-primary/40' : '',
          editable && !isEditing
            ? 'cursor-pointer hover:ring-1 hover:ring-inset hover:ring-border/60'
            : '',
        ]"
        @click="handleEditClick"
      >
        <ChatMentionText :text="text" :highlights="metadata.mentionHighlights" />
      </AiElementsMessageMessageContent>
    </AiElementsMessageMessage>

    <AiElementsMessageMessageActions class="justify-end gap-2 text-xs text-muted-foreground">
      <AiElementsMessageMessageAction
        v-if="editable"
        tooltip="Edit message"
        label="Edit message"
        class="size-7"
        :disabled="isEditing"
        @click="handleEditClick"
      >
        <AppIcon name="pencil" class="size-3.5" />
      </AiElementsMessageMessageAction>
      <span v-if="relativeTime || modelLabel" class="truncate max-w-64">
        <template v-if="relativeTime && modelLabel">
          {{ relativeTime }} on {{ modelLabel }}
        </template>
        <template v-else-if="relativeTime">
          {{ relativeTime }}
        </template>
        <template v-else>
          {{ modelLabel }}
        </template>
      </span>
    </AiElementsMessageMessageActions>
  </div>
</template>
