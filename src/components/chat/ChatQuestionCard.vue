<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue'
import type { PendingQuestionState } from '@/types/chat/pending-question'
import type { QuestionItem } from '@/types/harness/question-item'
import { PromptInputSubmit } from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Marker, MarkerContent } from '@/components/shadcn/ui/marker'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'

const props = defineProps<{
  question: PendingQuestionState
}>()

const emit = defineEmits<{
  submit: [toolCallId: string, answer: string]
}>()

const items = computed<QuestionItem[]>(() =>
  props.question.questions && props.question.questions.length > 0
    ? props.question.questions
    : [{ question: props.question.question, options: props.question.options }],
)
const index = ref(0)
const answers = ref<string[]>([])
const submitted = ref(false)

const current = computed<QuestionItem>(() => items.value[index.value] ?? { question: '' })
const currentAnswer = computed(() => answers.value[index.value] ?? '')
const isMulti = computed(() => items.value.length > 1)
const isLast = computed(() => index.value >= items.value.length - 1)
const draft = computed({
  get: () => currentAnswer.value,
  set: (value: string) => {
    const next = [...answers.value]
    next[index.value] = value
    answers.value = next
  },
})

const buildAnswer = (): string => {
  if (!isMulti.value) {
    return (answers.value[0] ?? '').trim()
  }
  return items.value
    .map((item, itemIndex) => {
      const answer = (answers.value[itemIndex] ?? '').trim()
      return `${itemIndex + 1}. ${item.question}\nAnswer: ${answer}`
    })
    .join('\n\n')
}

const handleSubmit = (): void => {
  if (submitted.value) {
    return
  }
  const answered = items.value.every((_, itemIndex) => (answers.value[itemIndex] ?? '').trim())
  if (!answered) {
    return
  }
  const answer = buildAnswer()
  if (!answer) {
    return
  }
  submitted.value = true
  emit('submit', props.question.toolCallId, answer)
}

const handleNext = (): void => {
  if (!currentAnswer.value.trim()) {
    return
  }
  if (isLast.value) {
    handleSubmit()
    return
  }
  index.value += 1
}

const handleBack = (): void => {
  if (index.value > 0) {
    index.value -= 1
  }
}

const handleOption = (option: string): void => {
  draft.value = option
  handleNext()
}

const handleCustomSubmit = (): void => {
  try {
    handleNext()
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
        {{ isMulti ? `Question ${index + 1} of ${items.length}` : 'Waiting for your answer' }}
      </MarkerContent>
    </Marker>
    <p class="text-sm text-foreground">
      {{ current.question }}
    </p>
    <div
      v-if="current.options && current.options.length > 0"
      class="flex flex-wrap gap-2"
    >
      <Button
        v-for="option in current.options"
        :key="option"
        size="sm"
        :variant="currentAnswer === option ? 'secondary' : 'outline'"
        :disabled="submitted"
        @click="handleOption(option)"
      >
        {{ option }}
      </Button>
    </div>
    <div class="flex gap-2">
      <TooltipProvider v-if="isMulti">
        <Tooltip v-if="index > 0">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous question"
              :disabled="submitted"
              @click="handleBack"
            >
              <ChevronLeftIcon class="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Previous question</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Input
        v-model="draft"
        placeholder="Type your answer"
        class="min-w-0 flex-1"
        :disabled="submitted"
        @keydown.enter.prevent="handleCustomSubmit"
      />
      <PromptInputSubmit
        v-if="!isMulti || isLast"
        :disabled="submitted || currentAnswer.trim().length === 0"
        @click="handleCustomSubmit"
      />
      <TooltipProvider v-else>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next question"
              :disabled="submitted || currentAnswer.trim().length === 0"
              @click="handleNext"
            >
              <ChevronRightIcon class="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Next question</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>