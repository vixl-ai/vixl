<script setup lang="ts">
import { Button } from '@/components/shadcn/ui/button'
import ModelsSearchModelSelectorList from '@/components/ai-elements/model-selector/ModelSelectorList.vue'
import ModelsSearchModelSelectorGroup from '@/components/ai-elements/model-selector/ModelSelectorGroup.vue'
import ModelsSearchModelSelectorItem from '@/components/ai-elements/model-selector/ModelSelectorItem.vue'
import ModelsSearchModelSelectorEmpty from '@/components/ai-elements/model-selector/ModelSelectorEmpty.vue'
import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import type { ModelCatalogOption } from '@/types/models/model-catalog-option'
import type { ModelRef } from '@/types/models/model-ref'
import type { ScoredVendorGroup } from '@/types/models/scored-vendor-group'
import type { ScoredVendorModelEntry } from '@/types/models/scored-vendor-model-entry'
import type { ReasoningCapability } from '@/services/models/resolve-reasoning-capability'
import serializeModelRef from '@/utils/serialize-model-ref'
import resolveSupportsFast from '@/services/models/resolve-fast-capability'

defineProps<{
  loading: boolean
  hasProviders: boolean
  groups: ScoredVendorGroup[]
  disabledEntries: ScoredVendorModelEntry[]
  searchQuery: string
  optionsOpenFor: string | null
  optionFor: (model: ModelRef) => ModelCatalogOption
  capabilityFor: (model: ModelRef) => ReasoningCapability
  metaFor: (model: ModelRef) => ModelCatalogMeta
}>()

const emit = defineEmits<{
  select: [providerId: string, modelId: string]
  openProviders: []
  'update:optionsOpenFor': [serialized: string, open: boolean]
  optionChange: [model: ModelRef, patch: ModelCatalogOption]
}>()

const serializedFor = (model: ModelRef): string =>
  serializeModelRef({ providerId: model.providerId, modelId: model.modelId })

const handleSelect = (providerId: string, modelId: string): void => {
  emit('select', providerId, modelId)
}

const handleOpenProviders = (): void => {
  emit('openProviders')
}

const handleOptionsOpen = (serialized: string, open: boolean): void => {
  emit('update:optionsOpenFor', serialized, open)
}

const handleOptionChange = (
  model: ModelRef,
  patch: ModelCatalogOption,
): void => {
  emit('optionChange', model, patch)
}
</script>

<template>
  <ModelsSearchModelSelectorList>
    <template v-if="loading">
      <ModelsSearchModelSelectorEmpty>Loading models...</ModelsSearchModelSelectorEmpty>
    </template>
    <template v-else-if="!hasProviders">
      <ModelsSearchModelSelectorEmpty>
        <div class="space-y-2 text-center">
          <p>No providers configured.</p>
          <Button variant="outline" size="sm" @click="handleOpenProviders">
            Add a provider
          </Button>
        </div>
      </ModelsSearchModelSelectorEmpty>
    </template>
    <template v-else-if="groups.length === 0 && disabledEntries.length === 0">
      <ModelsSearchModelSelectorEmpty>No models match your search.</ModelsSearchModelSelectorEmpty>
    </template>
    <template v-else>
      <ModelsSearchModelSelectorGroup
        v-for="group in groups"
        :key="group.vendorId"
        :heading="group.name"
      >
        <ModelsSearchModelSelectorItem
          v-for="model in group.models"
          :key="serializedFor(model)"
          :value="`${serializedFor(model)} ${model.modelId} ${model.label} ${model.providerName} ${group.name}`"
          class="group/item"
          @select="handleSelect(model.providerId, model.modelId)"
        >
          <span class="sr-only">
            {{ model.modelId }} {{ group.name }}
          </span>
          <ModelSearchResultRow
            :model="model"
            :query="searchQuery"
            :options-open="optionsOpenFor === serializedFor(model)"
            :option="optionFor(model)"
            :capability="capabilityFor(model)"
            :supports-fast="resolveSupportsFast(model)"
            :meta="metaFor(model)"
            :options-title="`Options for ${model.label}`"
            :show-disabled-badge="optionFor(model).allowed === false"
            @update:options-open="handleOptionsOpen(serializedFor(model), $event)"
            @change="handleOptionChange(model, $event)"
          />
        </ModelsSearchModelSelectorItem>
      </ModelsSearchModelSelectorGroup>
      <div
        v-if="disabledEntries.length > 0"
        class="pt-2"
      >
        <p class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Disabled
        </p>
        <div
          v-for="model in disabledEntries"
          :key="`disabled-${serializedFor(model)}`"
          class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm opacity-60"
        >
          <ModelSearchResultRow
            :model="model"
            :query="searchQuery"
            :options-open="optionsOpenFor === serializedFor(model)"
            :option="optionFor(model)"
            :capability="capabilityFor(model)"
            :supports-fast="resolveSupportsFast(model)"
            :meta="metaFor(model)"
            :options-title="`Re-enable ${model.label}`"
            @update:options-open="handleOptionsOpen(serializedFor(model), $event)"
            @change="handleOptionChange(model, $event)"
          />
        </div>
      </div>
    </template>
  </ModelsSearchModelSelectorList>
</template>
