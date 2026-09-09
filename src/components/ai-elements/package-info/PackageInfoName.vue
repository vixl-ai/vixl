<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { usePackageInfoContext } from './context'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { name } = usePackageInfoContext()
</script>

<template>
  <div :class="cn('flex items-center gap-2', props.class)" v-bind="$attrs">
    <AppIcon name="package" class="size-4 text-muted-foreground" />
    <span class="font-medium font-mono text-sm">
      <slot>{{ name }}</slot>
    </span>
  </div>
</template>
