<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { X } from '@lucide/vue'
import { Command } from '@/components/ui/command'
import { DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface Props {
  title?: string
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Model Selector',
})
</script>

<template>
  <DialogContent
    :class="cn('p-0', props.class)"
    :show-close-button="false"
    v-bind="$attrs"
  >
    <DialogTitle class="sr-only">
      {{ props.title }}
    </DialogTitle>
    <Command class="relative">
      <DialogClose
        data-slot="dialog-close"
        class="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-2.5 right-3 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
      >
        <X />
        <span class="sr-only">Close</span>
      </DialogClose>
      <slot />
    </Command>
  </DialogContent>
</template>
