<script setup lang="ts">
import { ref } from 'vue'
import { ChevronRight } from '@lucide/vue'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'

defineProps<{
  title: string
}>()

const open = ref(false)
</script>

<template>
  <Collapsible v-model:open="open" class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-4">
      <CollapsibleTrigger
        class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
      >
        <ChevronRight
          class="h-4 w-4 shrink-0 transition-transform"
          :class="open ? 'rotate-90' : ''"
        />
        {{ title }}
      </CollapsibleTrigger>
      <div
        v-if="$slots.actions"
        class="flex items-center gap-2"
      >
        <slot name="actions" />
      </div>
    </div>
    <CollapsibleContent>
      <slot />
    </CollapsibleContent>
  </Collapsible>
</template>
