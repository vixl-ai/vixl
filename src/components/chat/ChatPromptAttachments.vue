<script setup lang="ts">
import { computed } from 'vue'
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments'
import { usePromptInput } from '@/components/ai-elements/prompt-input/context'

const promptInput = usePromptInput()

const draftFiles = computed(() => promptInput.files.value)

const hasAttachments = computed(() => draftFiles.value.length > 0)

const handleRemoveFile = (id: string): void => {
  promptInput.removeFile(id)
}
</script>

<template>
  <div
    v-if="hasAttachments"
    data-align="block-start"
    class="order-first flex w-full flex-wrap items-start justify-start gap-2 px-3 pt-2"
  >
    <Attachments
      variant="grid"
      class="w-full justify-start"
    >
      <Attachment
        v-for="file in draftFiles"
        :key="file.id"
        :data="file"
        class="size-12"
        @remove="handleRemoveFile(file.id)"
      >
        <AttachmentPreview />
        <AttachmentRemove class="top-0.5 right-0.5 size-4 [&>svg]:size-2.5" />
      </Attachment>
    </Attachments>
  </div>
</template>
