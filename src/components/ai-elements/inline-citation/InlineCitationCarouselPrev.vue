<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { useCarousel } from '@/components/ui/carousel'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const { scrollPrev } = useCarousel()
</script>

<template>
  <button
    :class="cn('shrink-0', props.class)"
    type="button"
    aria-label="Previous"
    @click="scrollPrev"
  >
    <AppIcon name="arrow-left" class="size-4 text-muted-foreground" />
  </button>
</template>
