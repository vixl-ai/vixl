<script setup lang="ts">
import { Settings2Icon } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/shadcn/ui/popover'
import ModelsSearchModelSelectorLogo from '@/components/ai-elements/model-selector/ModelSelectorLogo.vue'
import ModelsSearchModelSelectorName from '@/components/ai-elements/model-selector/ModelSelectorName.vue'
import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import type { ModelCatalogOption } from '@/types/models/model-catalog-option'
import type { ScoredVendorModelEntry } from '@/types/models/scored-vendor-model-entry'
import type { ReasoningCapability } from '@/services/models/resolve-reasoning-capability'

withDefaults(
  defineProps<{
    model: ScoredVendorModelEntry
    query: string
    optionsOpen: boolean
    option: ModelCatalogOption
    capability: ReasoningCapability
    supportsFast: boolean
    optionsTitle: string
    showDisabledBadge?: boolean
    meta?: ModelCatalogMeta
  }>(),
  {
    showDisabledBadge: false,
    meta: () => ({}),
  },
)

const emit = defineEmits<{
  'update:optionsOpen': [open: boolean]
  change: [patch: ModelCatalogOption]
}>()

const handleOptionsOpen = (next: boolean): void => {
  emit('update:optionsOpen', next)
}

const handleChange = (patch: ModelCatalogOption): void => {
  emit('change', patch)
}
</script>

<template>
  <ModelsSearchModelSelectorLogo :provider="model.providerId" />
  <ModelsSearchModelSelectorName class="min-w-0 flex-1 truncate">
    <span class="truncate">
      <QueryMatchText :text="model.label" :query="query" />
    </span>
    <span class="ml-1.5 text-xs font-normal text-muted-foreground">
      <QueryMatchText
        :text="model.providerName"
        :query="query"
        unmatched-class="text-muted-foreground"
      />
    </span>
    <span
      v-if="showDisabledBadge"
      class="ml-1 text-xs text-muted-foreground"
    >
      (disabled)
    </span>
  </ModelsSearchModelSelectorName>
  <Popover
    :open="optionsOpen"
    @update:open="handleOptionsOpen"
  >
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="h-7 w-7 shrink-0"
        :title="optionsTitle"
        @click.stop
        @pointerdown.stop
      >
        <Settings2Icon class="size-3.5" />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      class="w-72"
      align="end"
      :side-offset="6"
      @click.stop
      @pointerdown.stop
    >
      <ModelCatalogOptionsPanel
        :option="option"
        :capability="capability"
        :supports-fast="supportsFast"
        :meta="meta"
        @change="handleChange"
      />
    </PopoverContent>
  </Popover>
</template>
