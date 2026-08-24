<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CommandInput } from '@/components/ui/command'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <CommandInput
    :class="props.class"
    v-bind="$attrs"
  />
</template>
