<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { PendingQuestionState } from '@/types/chat/pending-question'
import { PromptInputSubmit } from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Marker, MarkerContent } from '@/components/shadcn/ui/marker'

const props = defineProps<{
  question: PendingQuestionState
}>()

const emit = defineEmits<{
  submit: [toolCallId: string, answer: string]
}>()

const customAnswer = ref('')
const submitted = ref(false)

const handleSubmit = (answer: string): void => {
  const trimmed = answer.trim()
  if (!trimmed || submitted.value) {
    return
  }
  submitted.value = true
  emit('submit', props.question.toolCallId, trimmed)
}

const handleCustomSubmit = (): void => {
  try {
    handleSubmit(customAnswer.value)
  } catch (error) {
    toast.error('Failed to submit answer', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <div class="w-full space-y-3">
    <Marker variant="border" class="w-full">
      <MarkerContent>
        Waiting for your answer
      </MarkerContent>
    </Marker>
    <p class="text-sm text-foreground">
      {{ question.question }}
    </p>
    <div
      v-if="question.options && question.options.length > 0"
      class="flex flex-wrap gap-2"
    >
      <Button
        v-for="option in question.options"
        :key="option"
        size="sm"
        variant="outline"
        :disabled="submitted"
        @click="handleSubmit(option)"
      >
        {{ option }}
      </Button>
    </div>
    <div class="flex gap-2">
      <Input
        v-model="customAnswer"
        placeholder="Type your answer"
        class="min-w-0 flex-1"
        :disabled="submitted"
        @keydown.enter.prevent="handleCustomSubmit"
      />
      <PromptInputSubmit
        :disabled="submitted || customAnswer.trim().length === 0"
        @click="handleCustomSubmit"
      />
    </div>
  </div>
</template>
