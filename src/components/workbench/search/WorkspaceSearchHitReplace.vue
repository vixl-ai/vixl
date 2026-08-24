<script setup lang="ts">
import { Replace } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import type { GrepMatch } from '@/services/vixl/vixl-tauri'

const props = defineProps<{
  hit: GrepMatch
  replacing: boolean
}>()

const emit = defineEmits<{
  replace: [hit: GrepMatch]
}>()

const handleReplace = (event: MouseEvent): void => {
  event.stopPropagation()
  event.preventDefault()
  if (props.replacing) {
    return
  }
  emit('replace', props.hit)
}
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Replace match"
        :disabled="replacing"
        @click="handleReplace"
      >
        <Replace class="h-3 w-3" />
      </Button>
    </TooltipTrigger>
    <TooltipContent class="z-60">Replace</TooltipContent>
  </Tooltip>
</template>
