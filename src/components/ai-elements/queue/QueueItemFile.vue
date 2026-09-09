<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <span
    :class="cn('flex items-center gap-1 rounded border bg-muted px-2 py-1 text-xs', props.class)"
  >
    <AppIcon name="paperclip" :size="12" />
    <span class="max-w-[100px] truncate">
      <slot />
    </span>
  </span>
</template>
