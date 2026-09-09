<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <AppIcon
    name="file"
    :class="cn('size-3.5 shrink-0 text-muted-foreground', props.class)"
    v-bind="$attrs"
  />
</template>
