<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CommandInput } from '@/components/ui/command'

type VoiceSelectorInputProps = InstanceType<typeof CommandInput>['$props']

interface Props extends /* @vue-ignore */ VoiceSelectorInputProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <CommandInput
    :class="props.class"
  />
</template>
