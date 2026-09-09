<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Button } from '@/components/shadcn/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'
import { useRightSidebar } from './utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const { toggleSidebar } = useRightSidebar()
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        data-slot="right-sidebar-trigger"
        variant="ghost"
        size="icon"
        :class="cn('h-7 w-7', props.class)"
        aria-label="Toggle right sidebar"
        @click="toggleSidebar"
      >
        <AppIcon name="panel-right" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Toggle right sidebar</TooltipContent>
  </Tooltip>
</template>
