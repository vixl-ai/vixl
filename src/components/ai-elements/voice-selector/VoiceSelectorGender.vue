<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
  value?: 'male' | 'female' | 'transgender' | 'androgyne' | 'non-binary' | 'intersex'
}

const props = defineProps<Props>()
</script>

<template>
  <span :class="cn('text-muted-foreground text-xs', props.class)">
    <slot>
      <AppIcon name="mars" v-if="props.value === 'male'" class="size-4" />
      <AppIcon name="venus" v-else-if="props.value === 'female'" class="size-4" />
      <AppIcon name="transgender" v-else-if="props.value === 'transgender'" class="size-4" />
      <AppIcon name="mars-stroke" v-else-if="props.value === 'androgyne'" class="size-4" />
      <AppIcon name="non-binary" v-else-if="props.value === 'non-binary'" class="size-4" />
      <AppIcon name="venus-and-mars" v-else-if="props.value === 'intersex'" class="size-4" />
      <AppIcon name="circle-small" v-else class="size-1" fill="currentColor" />
    </slot>
  </span>
</template>
