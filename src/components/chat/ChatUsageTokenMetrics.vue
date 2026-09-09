<script setup lang="ts">
import { AppIcon } from '@/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'

const props = withDefaults(
  defineProps<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }>(),
  {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
)

const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact' })

const formatTokens = (tokens: number): string => compactFormatter.format(tokens)
</script>

<template>
  <div class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="inline-flex items-center gap-0.5">
          <AppIcon name="arrow-up" class="size-3 shrink-0" aria-label="Input" />
          <span class="tabular-nums">{{ formatTokens(props.inputTokens) }}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Input</TooltipContent>
    </Tooltip>

    <Tooltip>
      <TooltipTrigger as-child>
        <span class="inline-flex items-center gap-0.5">
          <AppIcon name="arrow-down" class="size-3 shrink-0" aria-label="Output" />
          <span class="tabular-nums">{{ formatTokens(props.outputTokens) }}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Output</TooltipContent>
    </Tooltip>

    <Tooltip v-if="props.cacheReadTokens > 0">
      <TooltipTrigger as-child>
        <span class="inline-flex items-center gap-0.5">
          <AppIcon name="database" class="size-3 shrink-0" aria-label="Cache read" />
          <span class="tabular-nums">{{ formatTokens(props.cacheReadTokens) }}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Cache read</TooltipContent>
    </Tooltip>

    <Tooltip v-if="props.cacheWriteTokens > 0">
      <TooltipTrigger as-child>
        <span class="inline-flex items-center gap-0.5">
          <AppIcon name="hard-drive-upload" class="size-3 shrink-0" aria-label="Cache write" />
          <span class="tabular-nums">{{ formatTokens(props.cacheWriteTokens) }}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Cache write</TooltipContent>
    </Tooltip>
  </div>
</template>
