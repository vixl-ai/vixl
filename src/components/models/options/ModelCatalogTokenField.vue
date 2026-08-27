<script setup lang="ts">
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import {
  formatTokenCount,
  parseCatalogTokenOverride,
} from '@/services/models/options'

const props = defineProps<{
  label: string
  modelValue?: number
  reportedMax?: number
}>()

const emit = defineEmits<{
  change: [value: number | undefined]
}>()

const draft = ref(
  typeof props.modelValue === 'number' ? String(props.modelValue) : '',
)

const htmlMax = computed(() =>
  typeof props.reportedMax === 'number' && props.reportedMax > 0
    ? props.reportedMax
    : undefined,
)

const placeholder = computed(() => {
  const reported = htmlMax.value
  if (typeof reported === 'number') {
    return formatTokenCount(reported)
  }
  return 'Default'
})

const syncDraftFromProp = (value: number | undefined): void => {
  draft.value = typeof value === 'number' ? String(value) : ''
}

const handleDraft = (value: string | number): void => {
  draft.value = String(value)
}

const handleCommit = (): void => {
  const trimmed = draft.value.trim()
  if (trimmed === '') {
    emit('change', undefined)
    return
  }
  const parsed = parseCatalogTokenOverride(trimmed, props.reportedMax)
  if (parsed === undefined) {
    syncDraftFromProp(props.modelValue)
    return
  }
  draft.value = String(parsed)
  emit('change', parsed)
}

watch(
  () => props.modelValue,
  (value) => {
    syncDraftFromProp(value)
  },
)
</script>

<template>
  <div class="space-y-1.5">
    <Label class="text-xs font-normal">{{ label }}</Label>
    <Input
      :model-value="draft"
      type="number"
      inputmode="numeric"
      min="1"
      :max="htmlMax"
      step="1"
      :placeholder="placeholder"
      class="h-8"
      @update:model-value="handleDraft"
      @change="handleCommit"
    />
  </div>
</template>
