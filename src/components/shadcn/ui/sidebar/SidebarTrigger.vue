<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Button } from '@/components/shadcn/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'
import { useSidebar } from './utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const { toggleSidebar } = useSidebar()
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        data-sidebar="trigger"
        data-slot="sidebar-trigger"
        variant="ghost"
        size="icon"
        :class="cn('h-7 w-7', props.class)"
        aria-label="Toggle left sidebar"
        @click="toggleSidebar"
      >
        <AppIcon name="panel-left" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Toggle left sidebar</TooltipContent>
  </Tooltip>
</template>
