<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  count: number
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <span
    v-if="props.count > 0"
    :class="cn('text-red-600 dark:text-red-400', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <AppIcon name="minus" class="inline-block size-3" />
      {{ props.count }}
    </slot>
  </span>
</template>
