<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { TestStatusType } from './context'
import { AppIcon, type AppIconName } from '@/icons'
import { cn } from '@/lib/utils'
import { useTestContext } from './context'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { status } = useTestContext()

const statusStyles: Record<TestStatusType, string> = {
  passed: 'text-green-600 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400',
  skipped: 'text-yellow-600 dark:text-yellow-400',
  running: 'text-blue-600 dark:text-blue-400',
}

const statusIcons: Record<TestStatusType, AppIconName> = {
  passed: 'circle-check-big',
  failed: 'circle-x',
  skipped: 'circle',
  running: 'circle-dot',
}
</script>

<template>
  <span
    v-if="status"
    :class="cn('shrink-0', status ? statusStyles[status] : '', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <AppIcon
        :name="statusIcons[status]"
        :class="cn('size-4', status === 'running' && 'animate-pulse')"
      />
    </slot>
  </span>
</template>
