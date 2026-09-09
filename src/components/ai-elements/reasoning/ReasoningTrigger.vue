<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { computed } from 'vue'
import { Shimmer } from '../shimmer'
import { useReasoningContext } from './context'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { isStreaming, isOpen, duration } = useReasoningContext()

const thinkingMessage = computed(() => {
  if (isStreaming.value || duration.value === 0) {
    return 'thinking'
  }
  if (duration.value === undefined) {
    return 'default_done'
  }
  return 'duration_done'
})
</script>

<template>
  <CollapsibleTrigger
    :class="
      cn(
        'flex w-fit items-center gap-1.5 text-muted-foreground text-xs font-medium transition-colors hover:text-foreground',
        props.class,
      )
    "
  >
    <slot>
      <template v-if="thinkingMessage === 'thinking'">
        <Shimmer :duration="1"> Thinking... </Shimmer>
      </template>

      <template v-else-if="thinkingMessage === 'default_done'">
        <span>Thought for a few seconds</span>
      </template>

      <template v-else>
        <span>Thought for {{ duration }} {{ duration === 1 ? 'second' : 'seconds' }}</span>
      </template>

      <AppIcon
        name="chevron-down"
        :class="cn('size-3.5 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')"
      />
    </slot>
  </CollapsibleTrigger>
</template>
