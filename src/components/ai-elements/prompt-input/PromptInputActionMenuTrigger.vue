<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { InputGroupButton } from '@/components/ui/input-group'
import PromptInputButton from './PromptInputButton.vue'

type DropdownMenuTriggerProps = InstanceType<typeof DropdownMenuTrigger>['$props']
type InputGroupButtonProps = InstanceType<typeof InputGroupButton>['$props']

interface Props extends /* @vue-ignore */ DropdownMenuTriggerProps {
  class?: HTMLAttributes['class']
  size?: InputGroupButtonProps['size']
}

const props = defineProps<Props>()
</script>

<template>
  <DropdownMenuTrigger as-child>
    <PromptInputButton :class="props.class" v-bind="props">
      <slot><AppIcon name="plus" class="size-4" /></slot>
    </PromptInputButton>
  </DropdownMenuTrigger>
</template>
