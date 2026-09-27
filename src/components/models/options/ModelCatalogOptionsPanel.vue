<script setup lang="ts">
import { Label } from '@/components/shadcn/ui/label'
import { Switch } from '@/components/shadcn/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  contextWindowSelectValues,
  formatCatalogMetaHint,
  maxOutputSelectValues,
} from '@/services/models/options'
import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import type { ModelCatalogOption } from '@/types/models/model-catalog-option'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import { isReasoningLevel, REASONING_LEVEL_LABELS } from '@/types/models/reasoning-level'
import type { ReasoningCapability } from '@/services/models/resolve-reasoning-capability'

const props = withDefaults(
  defineProps<{
    option: ModelCatalogOption
    capability: ReasoningCapability
    supportsFast?: boolean
    meta?: ModelCatalogMeta
  }>(),
  {
    supportsFast: false,
    meta: () => ({}),
  },
)

const emit = defineEmits<{
  change: [patch: ModelCatalogOption]
}>()

const allowed = computed(() => props.option.allowed !== false)
const fast = computed(() => props.option.fast === true)
const reasoningSelectLevels = computed(() =>
  props.capability.levels.filter((level) => level !== 'provider-default'),
)
const displayedReasoning = computed(() => {
  const value = props.option.reasoning
  if (!value || value === 'provider-default') {
    return props.capability.defaultLevel
  }
  if (!reasoningSelectLevels.value.includes(value)) {
    return props.capability.defaultLevel
  }
  return value
})
const contextValues = computed(() =>
  contextWindowSelectValues(props.meta.contextWindow, props.option.contextWindow),
)

const outputValues = computed(() =>
  maxOutputSelectValues(props.meta.maxOutputTokens, props.option.maxOutputTokens),
)

const hintLines = computed(() =>
  formatCatalogMetaHint(props.meta, {
    omitContext: contextValues.value.length > 0,
    omitOutput: outputValues.value.length > 0,
  }),
)

const reasoningSelectLabel = (level: ReasoningLevel): string => {
  const label = REASONING_LEVEL_LABELS[level]
  if (level === props.capability.defaultLevel) {
    return `${label} (default)`
  }
  return label
}

const handleAllowed = (value: boolean): void => {
  emit('change', { allowed: value ? true : false })
}

const handleFast = (value: boolean): void => {
  emit('change', { fast: value })
}

const handleReasoning = (value: unknown): void => {
  if (typeof value !== 'string' || !isReasoningLevel(value)) {
    return
  }
  if (value === 'provider-default') {
    return
  }
  emit('change', {
    reasoning: value === props.capability.defaultLevel ? 'provider-default' : value,
  })
}

const handleContextWindow = (value: number | undefined): void => {
  emit('change', { contextWindow: value })
}

const handleMaxOutputTokens = (value: number | undefined): void => {
  emit('change', { maxOutputTokens: value })
}
</script>

<template>
  <div class="space-y-3 p-1" @click.stop @pointerdown.stop>
    <div class="flex items-center justify-between gap-3">
      <Label class="text-xs font-normal">Allowed in chat</Label>
      <Switch :model-value="allowed" @update:model-value="handleAllowed" />
    </div>
    <div v-if="supportsFast" class="flex items-center justify-between gap-3">
      <Label class="text-xs font-normal">Fast</Label>
      <Switch :model-value="fast" @update:model-value="handleFast" />
    </div>
    <div v-if="capability.supported" class="space-y-1.5">
      <Label class="text-xs font-normal">Reasoning</Label>
      <Select :model-value="displayedReasoning" @update:model-value="handleReasoning">
        <SelectTrigger size="sm" class="w-full">
          <SelectValue :placeholder="reasoningSelectLabel(capability.defaultLevel)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="level in reasoningSelectLevels" :key="level" :value="level">
            {{ reasoningSelectLabel(level) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
    <ModelCatalogTokenSelect
      v-if="contextValues.length > 0 && meta.contextWindow"
      label="Context window"
      :model-value="option.contextWindow"
      :reported-max="meta.contextWindow"
      :values="contextValues"
      @change="handleContextWindow"
    />
    <ModelCatalogTokenSelect
      v-if="outputValues.length > 0 && meta.maxOutputTokens"
      label="Max output"
      :model-value="option.maxOutputTokens"
      :reported-max="meta.maxOutputTokens"
      :values="outputValues"
      @change="handleMaxOutputTokens"
    />
    <ModelCapabilities
      :meta="meta"
      :option="option"
      :capability="capability"
      :supports-fast="supportsFast"
    />
    <ModelCostRates :option="option" :meta="meta" />
    <p
      v-if="hintLines.length > 0"
      class="space-y-0.5 text-[11px] leading-snug text-muted-foreground"
    >
      <span v-for="line in hintLines" :key="line" class="block">
        {{ line }}
      </span>
    </p>
  </div>
</template>
