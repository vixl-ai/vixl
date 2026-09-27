<script setup lang="ts">
import { Brain, Eye, Wrench, Zap } from '@lucide/vue'
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
import type { ReasoningCapability } from '@/services/models/resolve-reasoning-capability'
import {
  buildModelSearchCapabilities,
  type ModelSearchCapabilityKey,
} from '@/components/models/search/model-search-result-view'

const ICONS = {
  vision: Eye,
  tools: Wrench,
  reasoning: Brain,
  fast: Zap,
} as const satisfies Record<ModelSearchCapabilityKey, typeof Eye>

const props = withDefaults(
  defineProps<{
    option: ModelCatalogOption
    capability: ReasoningCapability
    supportsFast: boolean
    meta?: ModelCatalogMeta
    class?: HTMLAttributes['class']
  }>(),
  {
    meta: () => ({}),
  },
)

const items = computed(() =>
  buildModelSearchCapabilities({
    meta: props.meta,
    option: props.option,
    capability: props.capability,
    supportsFast: props.supportsFast,
  }),
)
</script>

<template>
  <TooltipProvider v-if="items.length > 0">
    <div :class="cn('inline-flex shrink-0 flex-nowrap items-center gap-1', props.class)">
      <Tooltip v-for="item in items" :key="item.key">
        <TooltipTrigger as-child>
          <span class="inline-flex shrink-0 items-center gap-0.5">
            <component
              :is="ICONS[item.key]"
              :class="
                item.muted
                  ? 'size-3.5 shrink-0 text-muted-foreground'
                  : 'size-3.5 shrink-0 text-foreground'
              "
              :aria-label="item.tooltip"
            />
            <span
              v-if="item.label"
              :class="
                item.muted
                  ? 'text-[10px] leading-none text-muted-foreground'
                  : 'text-[10px] leading-none text-foreground'
              "
            >
              {{ item.label }}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ item.tooltip }}</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
</template>
