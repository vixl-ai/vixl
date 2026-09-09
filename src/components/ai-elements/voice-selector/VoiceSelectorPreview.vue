<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
  playing?: boolean
  loading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'play'): void
}>()

function handleClick(event: MouseEvent) {
  event.stopPropagation()
  emit('play')
}
</script>

<template>
  <Button
    :aria-label="playing ? 'Pause preview' : 'Play preview'"
    :class="cn('size-6', props.class)"
    :disabled="loading"
    size="icon-sm"
    type="button"
    variant="outline"
    @click="handleClick"
  >
    <Spinner v-if="loading" class="size-3" />
    <AppIcon name="pause" v-else-if="playing" class="size-3" />
    <AppIcon name="play" v-else class="size-3" />
  </Button>
</template>
