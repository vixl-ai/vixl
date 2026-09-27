<script setup lang="ts">
import { ArrowDown, ArrowUp, Brain, Database, HardDriveUpload } from '@lucide/vue'
import type { HTMLAttributes } from 'vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import type { ModelCatalogOption } from '@/types/models/model-catalog-option'
import {
  buildModelCost,
  MODEL_COST_ESTIMATED_TOOLTIP,
  type ModelCostLineKey,
} from '@/components/models/model-cost-view'

const ICONS = {
  input: ArrowUp,
  output: ArrowDown,
  cacheRead: Database,
  cacheWrite: HardDriveUpload,
  reasoning: Brain,
} as const satisfies Record<ModelCostLineKey, typeof ArrowUp>

const props = withDefaults(
  defineProps<{
    option: ModelCatalogOption
    meta?: ModelCatalogMeta
    compact?: boolean
    class?: HTMLAttributes['class']
  }>(),
  {
    meta: () => ({}),
    compact: false,
  },
)

const view = computed(() =>
  buildModelCost({
    meta: props.meta,
    option: props.option,
  }),
)
</script>

<template>
  <TooltipProvider v-if="view">
    <div
      :class="
        cn(
          props.compact
            ? 'inline-flex shrink-0 flex-nowrap items-center gap-1.5 text-xs text-muted-foreground'
            : 'flex flex-wrap items-center gap-1.5 text-[11px] leading-snug text-muted-foreground',
          props.class,
        )
      "
    >
      <Tooltip v-if="view.estimated">
        <TooltipTrigger as-child>
          <span class="tabular-nums" aria-label="Estimated">{{ '~' }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ MODEL_COST_ESTIMATED_TOOLTIP }}</TooltipContent>
      </Tooltip>
      <Tooltip v-for="line in view.lines" :key="line.key">
        <TooltipTrigger as-child>
          <span class="inline-flex items-center gap-0.5">
            <component :is="ICONS[line.key]" class="size-3 shrink-0" :aria-label="line.label" />
            <span class="tabular-nums">{{ line.value }}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ line.tooltip }}</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
</template>
