<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { useForwardProps } from 'reka-ui'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()

const forwarded = useForwardProps(props)
</script>

<template>
  <div data-slot="input-otp-separator" role="separator" v-bind="forwarded">
    <slot>
      <AppIcon name="minus" />
    </slot>
  </div>
</template>
