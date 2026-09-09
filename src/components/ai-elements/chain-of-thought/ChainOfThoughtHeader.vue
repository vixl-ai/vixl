<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HtmlHTMLAttributes } from 'vue'
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useChainOfThought } from './context'

const props = defineProps<{
  class?: HtmlHTMLAttributes['class']
}>()

const { isOpen, setIsOpen } = useChainOfThought()
</script>

<template>
  <Collapsible :open="isOpen" @update:open="setIsOpen">
    <CollapsibleTrigger
      :class="
        cn(
          'flex w-fit items-center gap-1.5 text-muted-foreground text-xs font-medium transition-colors hover:text-foreground',
          props.class,
        )
      "
      v-bind="$attrs"
    >
      <span class="text-left">
        <slot>Chain of Thought</slot>
      </span>
      <AppIcon
        name="chevron-down"
        :class="cn('size-3.5 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')"
      />
    </CollapsibleTrigger>
  </Collapsible>
</template>
