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
import { REASONING_LEVEL_LABELS } from '@/types/models/reasoning-level'
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
const reasoning = computed(
  () => props.option.reasoning ?? 'provider-default',
)
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

const handleAllowed = (value: boolean): void => {
  emit('change', { allowed: value ? true : false })
}

const handleFast = (value: boolean): void => {
  emit('change', { fast: value })
}

const handleReasoning = (value: unknown): void => {
  if (typeof value !== 'string') {
    return
  }
  emit('change', {
    reasoning: value as ReasoningLevel,
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
  <div
    class="space-y-3 p-1"
    @click.stop
    @pointerdown.stop
  >
    <div class="flex items-center justify-between gap-3">
      <Label class="text-xs font-normal">Allowed in chat</Label>
      <Switch :model-value="allowed" @update:model-value="handleAllowed" />
    </div>
    <div
      v-if="supportsFast"
      class="flex items-center justify-between gap-3"
    >
      <Label class="text-xs font-normal">Fast</Label>
      <Switch :model-value="fast" @update:model-value="handleFast" />
    </div>
    <div
      v-if="capability.supported"
      class="space-y-1.5"
    >
      <Label class="text-xs font-normal">Reasoning</Label>
      <Select :model-value="reasoning" @update:model-value="handleReasoning">
        <SelectTrigger size="sm" class="w-full">
          <SelectValue placeholder="Default" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="level in capability.levels"
            :key="level"
            :value="level"
          >
            {{ REASONING_LEVEL_LABELS[level] }}
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
    <p
      v-if="hintLines.length > 0"
      class="space-y-0.5 text-[11px] leading-snug text-muted-foreground"
    >
      <span
        v-for="line in hintLines"
        :key="line"
        class="block"
      >
        {{ line }}
      </span>
    </p>
  </div>
</template>
