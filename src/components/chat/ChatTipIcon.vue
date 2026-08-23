<script setup lang="ts">
import type { Component } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const props = withDefaults(
  defineProps<{
    icon: Component
    tooltip: string
    iconClass?: string
    tone?: 'chat' | 'terminal'
  }>(),
  { tone: 'chat' },
)
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          :class="
            props.tone === 'terminal'
              ? 'size-7 shrink-0 hover:bg-zinc-800 hover:!text-current'
              : 'size-6 shrink-0 hover:!text-current'
          "
          :aria-label="tooltip"
          @click.stop
        >
          <component
            :is="icon"
            :class="iconClass ?? 'size-3.5'"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent class="z-60">{{ tooltip }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
