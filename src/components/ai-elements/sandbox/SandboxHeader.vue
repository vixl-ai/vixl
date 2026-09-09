<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { ToolUIPart } from 'ai'
import type { HTMLAttributes } from 'vue'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { ToolStatusBadge } from '../tool'

type CollapsibleTriggerProps = InstanceType<typeof CollapsibleTrigger>['$props']

interface Props extends /* @vue-ignore */ CollapsibleTriggerProps {
  title?: string
  state: ToolUIPart['state']
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <CollapsibleTrigger
    :class="cn('flex w-full items-center justify-between gap-4 p-3', props.class)"
    v-bind="$attrs"
  >
    <div class="flex items-center gap-2">
      <AppIcon name="code" class="size-4 text-muted-foreground" />
      <span class="font-medium text-sm">{{ title }}</span>
      <ToolStatusBadge :state="state" />
    </div>
    <AppIcon
      name="chevron-down"
      class="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
    />
  </CollapsibleTrigger>
</template>
