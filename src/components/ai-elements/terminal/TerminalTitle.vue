<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { TerminalIcon } from '@lucide/vue'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div
    :class="cn('flex min-w-0 items-center gap-2 text-sm text-zinc-400', props.class)"
    v-bind="$attrs"
  >
    <slot name="icon">
      <TerminalIcon class="size-4 shrink-0" />
    </slot>
    <div class="min-w-0 truncate">
      <slot>Terminal</slot>
    </div>
  </div>
</template>
