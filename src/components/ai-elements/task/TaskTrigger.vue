<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface TaskTriggerProps {
  title: string
  class?: HTMLAttributes['class']
}

const props = defineProps<TaskTriggerProps>()
</script>

<template>
  <CollapsibleTrigger as-child :class="cn('group', props.class)">
    <slot>
      <div
        class="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <AppIcon name="search" class="size-4" />
        <p class="text-sm">
          {{ props.title }}
        </p>
        <AppIcon
          name="chevron-down"
          class="size-4 transition-transform group-data-[state=open]:rotate-180"
        />
      </div>
    </slot>
  </CollapsibleTrigger>
</template>
