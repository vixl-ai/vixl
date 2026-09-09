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
  <span :class="cn('font-mono text-xs', props.class)" v-bind="$attrs">
    <AppIcon name="git-commit" class="mr-1 inline-block size-3" />
    <slot />
  </span>
</template>
