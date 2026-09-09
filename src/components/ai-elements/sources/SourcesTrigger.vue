<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

const props = defineProps<{
  count: number
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <CollapsibleTrigger :class="cn('flex items-center gap-2', props.class)">
    <slot>
      <p class="font-medium">Used {{ props.count }} sources</p>
      <AppIcon name="chevron-down" class="h-4 w-4" />
    </slot>
  </CollapsibleTrigger>
</template>
