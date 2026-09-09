<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div :class="cn('flex flex-1 items-center gap-2 overflow-hidden', props.class)" v-bind="$attrs">
    <AppIcon name="triangle-alert" class="size-4 shrink-0 text-destructive" />
    <slot />
  </div>
</template>
