<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { ChangeType } from './context'
import { AppIcon, type AppIconName } from '@/icons'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { usePackageInfoContext } from './context'

type BadgeProps = InstanceType<typeof Badge>['$props']

interface Props extends /* @vue-ignore */ BadgeProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { changeType } = usePackageInfoContext()

const changeTypeStyles: Record<ChangeType, string> = {
  major: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  minor: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  patch: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  added: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  removed: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
}

const changeTypeIcons: Record<ChangeType, AppIconName> = {
  major: 'arrow-right',
  minor: 'arrow-right',
  patch: 'arrow-right',
  added: 'plus',
  removed: 'minus',
}
</script>

<template>
  <Badge
    v-if="changeType"
    :class="cn('gap-1 text-xs capitalize', changeTypeStyles[changeType], props.class)"
    variant="secondary"
    v-bind="$attrs"
  >
    <AppIcon :name="changeTypeIcons[changeType]" class="size-3" />
    <slot>{{ changeType }}</slot>
  </Badge>
</template>
