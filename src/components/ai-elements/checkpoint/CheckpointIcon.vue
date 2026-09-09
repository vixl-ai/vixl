<script lang="ts" setup>
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <slot v-if="$slots.default" />

  <AppIcon name="bookmark" v-else :class="cn('size-4 shrink-0', props.class)" v-bind="$attrs" />
</template>
