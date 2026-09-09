<script setup lang="ts">
// import type { InputGroupButtonVariants } from '@/components/ui/input-group'
import type { ChatStatus } from 'ai'
import type { HTMLAttributes } from 'vue'
import { AppIcon, type AppIconName } from '@/icons'
import { InputGroupButton } from '@/components/ui/input-group'
import { cn } from '@/lib/utils'
import { computed } from 'vue'

type InputGroupButtonProps = InstanceType<typeof InputGroupButton>['$props']

interface Props extends /* @vue-ignore */ InputGroupButtonProps {
  class?: HTMLAttributes['class']
  status?: ChatStatus
  variant?: InputGroupButtonProps['variant']
  size?: InputGroupButtonProps['size']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'icon-sm',
})

const icon = computed((): AppIconName => {
  if (props.status === 'submitted') {
    return 'loader'
  } else if (props.status === 'streaming') {
    return 'square'
  } else if (props.status === 'error') {
    return 'x'
  }
  return 'arrow-up'
})

const iconClass = computed(() => {
  if (props.status === 'submitted') {
    return 'size-4 animate-spin'
  }
  return 'size-4'
})

const { status, size, variant, class: _, ...restProps } = props
</script>

<template>
  <InputGroupButton
    aria-label="Submit"
    :class="cn('rounded-md', props.class)"
    :size="size"
    :variant="variant"
    type="submit"
    v-bind="restProps"
  >
    <slot>
      <AppIcon :name="icon" :class="iconClass" />
    </slot>
  </InputGroupButton>
</template>
