<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { useCarousel } from '@/components/ui/carousel'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const { scrollNext } = useCarousel()
</script>

<template>
  <button :class="cn('shrink-0', props.class)" type="button" aria-label="Next" @click="scrollNext">
    <AppIcon name="arrow-right" class="size-4 text-muted-foreground" />
  </button>
</template>
