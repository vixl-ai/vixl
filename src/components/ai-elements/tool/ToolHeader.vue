<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { DynamicToolUIPart, ToolUIPart } from 'ai'
import type { HTMLAttributes } from 'vue'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { computed } from 'vue'
import StatusBadge from './ToolStatusBadge.vue'

type ToolHeaderProps = {
  title?: string
  class?: HTMLAttributes['class']
} & (
  | { type: ToolUIPart['type']; state: ToolUIPart['state']; toolName?: never }
  | { type: DynamicToolUIPart['type']; state: DynamicToolUIPart['state']; toolName: string }
)

const props = defineProps<ToolHeaderProps>()

const derivedName = computed(() =>
  props.type === 'dynamic-tool' ? props.toolName : props.type.split('-').slice(1).join('-'),
)
</script>

<template>
  <CollapsibleTrigger
    :class="cn('flex w-full items-center justify-between gap-4 p-3', props.class)"
    v-bind="$attrs"
  >
    <div class="flex items-center gap-2">
      <AppIcon name="wrench" class="size-4 text-muted-foreground" />
      <span class="font-medium text-sm">{{ props.title ?? derivedName }}</span>
      <StatusBadge :state="props.state" />
    </div>
    <AppIcon
      name="chevron-down"
      class="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
    />
  </CollapsibleTrigger>
</template>
