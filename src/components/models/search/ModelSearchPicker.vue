<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDownIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import ModelsSearchModelSelector from '@/components/ai-elements/model-selector/ModelSelector.vue'
import ModelsSearchModelSelectorContent from '@/components/ai-elements/model-selector/ModelSelectorContent.vue'
import ModelsSearchModelSelectorTrigger from '@/components/ai-elements/model-selector/ModelSelectorTrigger.vue'
import useVixlConfig from '@/composables/use-vixl-config'
import useProviderModelsCatalog from '@/composables/use-provider-models-catalog'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { ModelCatalogOption } from '@/types/models/model-catalog-option'
import type { ModelRef } from '@/types/models/model-ref'
import type { ScoredVendorGroup } from '@/types/models/scored-vendor-group'
import type { ScoredVendorModelEntry } from '@/types/models/scored-vendor-model-entry'
import type { SettingsTab } from '@/composables/use-vixl-config'
import serializeModelRef from '@/utils/serialize-model-ref'
import parseModelRef from '@/utils/parse-model-ref'
import humanizeModelId from '@/utils/humanize-model-id'
import {
  getClampedModelCatalogOption,
  getModelCatalogOption,
  isModelAllowed,
  mergeModelCatalogOption,
} from '@/services/models/model-catalog-options'
import clampModelCatalogOption from '@/services/models/clamp-model-catalog-option'
import resolveReasoningCapability from '@/services/models/resolve-reasoning-capability'
import { canonicalizeModelRef } from '@/services/models/resolve-model-ref-for-call'
import { isFastModelId } from '@/services/models/parse-model-variant'
import {
  filterScoredProviderModels,
  regroupScoredVendorModels,
  toScoredVendorModelEntries,
} from '@/services/models/search'

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    placeholder?: string
    compact?: boolean
    scopeSettings?: VixlSettings
    /** Hide models marked allowed:false (chat pickers). */
    hideDisallowed?: boolean
    /** Persist catalog option edits to this settings scope. */
    optionsTab?: SettingsTab
  }>(),
  {
    disabled: false,
    placeholder: 'Select model',
    compact: false,
    hideDisallowed: false,
    optionsTab: 'personal',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const router = useRouter()
const config = useVixlConfig()
const open = ref(false)
const searchQuery = ref('')
const optionsOpenFor = ref<string | null>(null)

const settingsSource = computed(
  () => props.scopeSettings ?? config.effectiveSettings.value,
)

const extraModelRefs = computed(() => {
  const parsed = parseModelRef(props.modelValue)
  if (!parsed) {
    return props.modelValue.trim() ? [props.modelValue] : []
  }
  const canonical = canonicalizeModelRef(parsed)
  const serialized = serializeModelRef(canonical)
  return serialized === props.modelValue ? [props.modelValue] : [serialized, props.modelValue]
})

const catalog = useProviderModelsCatalog({
  settings: settingsSource,
  extraModelRefs,
})

const scoredMatches = computed(() =>
  filterScoredProviderModels(catalog.groups.value, searchQuery.value),
)

const filteredGroups = computed((): ScoredVendorGroup[] => {
  const matches = props.hideDisallowed
    ? scoredMatches.value.filter((match) =>
        isModelAllowed(settingsSource.value, match.model),
      )
    : scoredMatches.value
  return regroupScoredVendorModels(matches)
})

const disabledEntries = computed((): ScoredVendorModelEntry[] => {
  if (!props.hideDisallowed) {
    return []
  }
  const matches = scoredMatches.value.filter(
    (match) => !isModelAllowed(settingsSource.value, match.model),
  )
  return toScoredVendorModelEntries(matches)
})

const canonicalSelection = computed(() => {
  const parsed = parseModelRef(props.modelValue)
  if (!parsed) {
    return null
  }
  return canonicalizeModelRef(parsed)
})

const displayLabel = computed(() => {
  if (!props.modelValue) {
    return props.placeholder
  }
  const canonical = canonicalSelection.value
  if (!canonical) {
    return catalog.labelForSerialized(props.modelValue)
  }
  return catalog.labelForSerialized(serializeModelRef(canonical))
})

const compactLabel = computed(() => {
  if (!props.modelValue) {
    return props.placeholder
  }
  const canonical = canonicalSelection.value
  if (!canonical) {
    const segments = props.modelValue.split('/')
    return segments[segments.length - 1] ?? props.modelValue
  }
  return humanizeModelId(canonical.modelId)
})

const selectedSuffix = computed(() => {
  const canonical = canonicalSelection.value
  if (!canonical) {
    return ''
  }
  const option = getClampedModelCatalogOption(settingsSource.value, canonical)
  const bits: string[] = []
  if (option.reasoning && option.reasoning !== 'provider-default') {
    bits.push(option.reasoning)
  }
  if (
    option.fast === true ||
    isFastModelId(parseModelRef(props.modelValue)?.modelId ?? '')
  ) {
    bits.push('fast')
  }
  return bits.length > 0 ? bits.join(', ') : ''
})

const handleOpenChange = (nextOpen: boolean): void => {
  open.value = nextOpen
  if (!nextOpen) {
    searchQuery.value = ''
    optionsOpenFor.value = null
  }
}

const handleSelect = (providerId: string, modelId: string): void => {
  const serialized = serializeModelRef({ providerId, modelId })
  emit('update:modelValue', serialized)
  open.value = false
  searchQuery.value = ''
  optionsOpenFor.value = null
}

const openProvidersSettings = async (): Promise<void> => {
  open.value = false
  await router.push({ path: '/settings', query: { section: 'providers' } })
}

const optionFor = (model: ModelRef): ModelCatalogOption => {
  const option = getModelCatalogOption(settingsSource.value, model)
  const selected = canonicalSelection.value
  let next = option
  if (
    selected &&
    selected.providerId === model.providerId &&
    selected.modelId === model.modelId &&
    isFastModelId(parseModelRef(props.modelValue)?.modelId ?? '')
  ) {
    next = { ...option, fast: true }
  }
  return clampModelCatalogOption(settingsSource.value, model, next)
}

const capabilityFor = (model: ModelRef) =>
  resolveReasoningCapability(settingsSource.value, model)

const openModelOptions = (serialized: string, next: boolean): void => {
  optionsOpenFor.value = next ? serialized : null
}

const handleOptionChange = async (
  model: ModelRef,
  patch: ModelCatalogOption,
): Promise<void> => {
  const nextMap = mergeModelCatalogOption(settingsSource.value, model, patch)
  try {
    await config.updateSetting(props.optionsTab, 'models.catalogOptions', nextMap)
    if (
      patch.fast !== undefined &&
      canonicalSelection.value &&
      canonicalSelection.value.providerId === model.providerId &&
      canonicalSelection.value.modelId === model.modelId &&
      isFastModelId(parseModelRef(props.modelValue)?.modelId ?? '')
    ) {
      emit('update:modelValue', serializeModelRef(model))
    }
  } catch (error) {
    toast.error('Failed to save model options', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

watch(
  () => [props.modelValue, catalog.loading.value] as const,
  async ([value, loading]) => {
    if (loading || !value.trim()) {
      return
    }
    const parsed = parseModelRef(value)
    if (!parsed || !isFastModelId(parsed.modelId)) {
      return
    }
    const canonical = canonicalizeModelRef(parsed)
    const nextSerialized = serializeModelRef(canonical)
    if (nextSerialized === value) {
      return
    }
    const nextMap = mergeModelCatalogOption(settingsSource.value, canonical, {
      ...getModelCatalogOption(settingsSource.value, parsed),
      ...getModelCatalogOption(settingsSource.value, canonical),
      fast: true,
    })
    try {
      await config.updateSetting(props.optionsTab, 'models.catalogOptions', nextMap)
      emit('update:modelValue', nextSerialized)
    } catch (error) {
      toast.error('Failed to normalize model selection', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  },
  { immediate: true },
)
</script>

<template>
  <ModelsSearchModelSelector :open="open" @update:open="handleOpenChange">
    <ModelsSearchModelSelectorTrigger as-child>
      <Button
        type="button"
        :variant="compact ? 'ghost' : 'outline'"
        :size="compact ? 'sm' : 'default'"
        :disabled="disabled || catalog.loading.value"
        :class="
          compact
            ? 'h-8 min-w-0 max-w-56 border-0 bg-transparent px-2 shadow-none hover:bg-transparent'
            : 'w-full max-w-md justify-between font-normal'
        "
        :title="displayLabel"
      >
        <span class="min-w-0 truncate text-sm @max-[22rem]/composer:hidden">
          {{ compact ? compactLabel : displayLabel }}
          <span
            v-if="selectedSuffix"
            class="text-muted-foreground"
          >
            ({{ selectedSuffix }})
          </span>
        </span>
        <ChevronDownIcon class="size-3.5 shrink-0 opacity-60" />
      </Button>
    </ModelsSearchModelSelectorTrigger>
    <ModelsSearchModelSelectorContent class="max-w-md">
      <ModelSearchInput v-model="searchQuery" />
      <ModelSearchPickerList
        :loading="catalog.loading.value"
        :has-providers="catalog.hasProviders.value"
        :groups="filteredGroups"
        :disabled-entries="disabledEntries"
        :search-query="searchQuery"
        :options-open-for="optionsOpenFor"
        :option-for="optionFor"
        :capability-for="capabilityFor"
        @select="handleSelect"
        @open-providers="openProvidersSettings"
        @update:options-open-for="openModelOptions"
        @option-change="handleOptionChange"
      />
    </ModelsSearchModelSelectorContent>
  </ModelsSearchModelSelector>
</template>
