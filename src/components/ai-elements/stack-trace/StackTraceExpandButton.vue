<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { useStackTraceContext } from './context'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { isOpen } = useStackTraceContext('StackTraceExpandButton')
</script>

<template>
  <div :class="cn('flex size-7 items-center justify-center', props.class)" v-bind="$attrs">
    <AppIcon
      name="chevron-down"
      :class="
        cn('size-4 text-muted-foreground transition-transform', isOpen ? 'rotate-180' : 'rotate-0')
      "
    />
  </div>
</template>
