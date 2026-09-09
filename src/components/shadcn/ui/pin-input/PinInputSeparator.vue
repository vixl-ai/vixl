<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { PrimitiveProps } from 'reka-ui'
import { Primitive, useForwardProps } from 'reka-ui'

const props = defineProps<PrimitiveProps>()
const forwardedProps = useForwardProps(props)
</script>

<template>
  <Primitive data-slot="pin-input-separator" v-bind="forwardedProps">
    <slot>
      <AppIcon name="minus" />
    </slot>
  </Primitive>
</template>
