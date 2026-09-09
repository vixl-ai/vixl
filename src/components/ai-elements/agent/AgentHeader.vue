<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const props = defineProps<{
  name: string
  model?: string
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    :class="cn('flex w-full items-center justify-between gap-4 p-3', props.class)"
    v-bind="$attrs"
  >
    <div class="flex items-center gap-2">
      <AppIcon name="bot" class="size-4 text-muted-foreground" />
      <span class="font-medium text-sm">{{ props.name }}</span>
      <Badge v-if="props.model" class="font-mono text-xs" variant="secondary">
        {{ props.model }}
      </Badge>
    </div>
  </div>
</template>
