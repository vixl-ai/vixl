<script setup lang="ts">
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Regex,
  Replace,
  WholeWord,
} from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import { Toggle } from '@/components/shadcn/ui/toggle'

const findQuery = defineModel<string>('findQuery', { required: true })
const replaceQuery = defineModel<string>('replaceQuery', { required: true })
const matchCase = defineModel<boolean>('matchCase', { required: true })
const matchWholeWord = defineModel<boolean>('matchWholeWord', { required: true })
const useRegex = defineModel<boolean>('useRegex', { required: true })
const includeGlob = defineModel<string>('includeGlob', { required: true })
const excludeGlob = defineModel<string>('excludeGlob', { required: true })

const props = defineProps<{
  replaceExpanded: boolean
  replacing?: boolean
}>()

const emit = defineEmits<{
  'toggle-replace': []
  'replace-one': []
  'replace-all': []
}>()

const findInputRef = ref<{ $el?: HTMLElement } | null>(null)
const replaceInputRef = ref<{ $el?: HTMLElement } | null>(null)

const focusInput = (target: { $el?: HTMLElement } | null): void => {
  const el = target?.$el
  if (el instanceof HTMLInputElement) {
    el.focus()
    el.select()
  }
}

const focusFind = (): void => {
  focusInput(findInputRef.value)
}

const focusReplace = (): void => {
  focusInput(replaceInputRef.value)
}

const handleReplaceOne = async (): Promise<void> => {
  if (props.replacing) {
    return
  }
  emit('replace-one')
}

const handleReplaceAll = async (): Promise<void> => {
  if (props.replacing) {
    return
  }
  emit('replace-all')
}

defineExpose({
  focusFind,
  focusReplace,
})
</script>

<template>
  <div class="flex flex-col gap-2 border-b border-border/20 px-2 py-2">
    <div class="flex items-start gap-1">
      <Button
        variant="ghost"
        size="icon"
        class="mt-0.5 h-7 w-7 shrink-0 text-muted-foreground"
        :aria-label="props.replaceExpanded ? 'Hide replace' : 'Show replace'"
        @click="emit('toggle-replace')"
      >
        <ChevronDown
          v-if="props.replaceExpanded"
          class="h-3.5 w-3.5"
        />
        <ChevronRight
          v-else
          class="h-3.5 w-3.5"
        />
      </Button>

      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex items-center gap-1">
          <Input
            ref="findInputRef"
            v-model="findQuery"
            placeholder="Find"
            class="h-7 min-w-0 flex-1 text-xs"
            aria-label="Find"
          />
          <Tooltip>
            <TooltipTrigger as-child>
              <Toggle
                :model-value="matchCase"
                size="sm"
                class="h-7 w-7 shrink-0 p-0"
                aria-label="Match case"
                @update:model-value="matchCase = $event"
              >
                <CaseSensitive class="h-3.5 w-3.5" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent class="z-60">Match case</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Toggle
                :model-value="matchWholeWord"
                size="sm"
                class="h-7 w-7 shrink-0 p-0"
                aria-label="Match whole word"
                @update:model-value="matchWholeWord = $event"
              >
                <WholeWord class="h-3.5 w-3.5" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent class="z-60">Match whole word</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Toggle
                :model-value="useRegex"
                size="sm"
                class="h-7 w-7 shrink-0 p-0"
                aria-label="Use regular expression"
                @update:model-value="useRegex = $event"
              >
                <Regex class="h-3.5 w-3.5" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent class="z-60">Use regular expression</TooltipContent>
          </Tooltip>
        </div>

        <div
          v-if="props.replaceExpanded"
          class="flex items-center gap-1"
        >
          <Input
            ref="replaceInputRef"
            v-model="replaceQuery"
            placeholder="Replace"
            class="h-7 min-w-0 flex-1 text-xs"
            aria-label="Replace"
          />
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 shrink-0 text-muted-foreground"
                aria-label="Replace"
                :disabled="replacing"
                @click="handleReplaceOne"
              >
                <Replace class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent class="z-60">Replace</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 shrink-0 px-2 text-xs text-muted-foreground"
            :disabled="replacing"
            @click="handleReplaceAll"
          >
            All
          </Button>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-1.5 pl-8">
      <label class="flex flex-col gap-1">
        <span class="text-[11px] text-muted-foreground">files to include</span>
        <Input
          v-model="includeGlob"
          placeholder="e.g. *.ts, src/**"
          class="h-7 text-xs"
          aria-label="Files to include"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[11px] text-muted-foreground">files to exclude</span>
        <Input
          v-model="excludeGlob"
          placeholder="e.g. dist/**, *.min.js"
          class="h-7 text-xs"
          aria-label="Files to exclude"
        />
      </label>
    </div>
  </div>
</template>
