<script setup lang="ts">
import { AppIcon } from '@/icons'
import { Button } from '@/components/shadcn/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'

const props = defineProps<{
  path: string
  replacing: boolean
}>()

const emit = defineEmits<{
  replace: [path: string]
}>()

const handleReplace = (event: MouseEvent): void => {
  event.stopPropagation()
  event.preventDefault()
  if (props.replacing) {
    return
  }
  emit('replace', props.path)
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
        aria-label="Replace all in file"
        :disabled="replacing"
        @click="handleReplace"
      >
        <AppIcon name="replace-all" class="h-3 w-3" />
      </Button>
    </TooltipTrigger>
    <TooltipContent class="z-60">Replace all in file</TooltipContent>
  </Tooltip>
</template>
