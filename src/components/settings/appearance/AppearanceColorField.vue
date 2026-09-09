<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed } from 'vue'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import { contrastRatio, hasInsufficientContrast, isValidHexColor } from './appearance-ui'

const props = defineProps<{
  label: string
  modelValue: string
  /** Optional background color to warn about low text contrast. */
  contrastAgainst?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
}>()

const fieldId = `appearance-color-${props.label
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`

const isValid = computed(() => isValidHexColor(props.modelValue))

const swatchColor = computed(() => (isValid.value ? props.modelValue : '#000000'))

const contrastRatioValue = computed(() => {
  if (!props.contrastAgainst || !isValid.value) {
    return null
  }
  return contrastRatio(props.modelValue, props.contrastAgainst)
})

const showContrastWarning = computed(
  () =>
    contrastRatioValue.value !== null &&
    props.contrastAgainst !== undefined &&
    hasInsufficientContrast(props.modelValue, props.contrastAgainst),
)

const handleColorInput = (event: Event): void => {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

const handleTextInput = (value: string | number): void => {
  emit('update:modelValue', String(value))
}
</script>

<template>
  <div class="space-y-1">
    <div class="flex items-center gap-2">
      <Label :for="fieldId" class="min-w-40 text-sm">
        {{ label }}
      </Label>
      <input
        :id="fieldId"
        type="color"
        class="h-7 w-9 cursor-pointer rounded border border-input bg-transparent p-0"
        :value="swatchColor"
        :disabled="disabled"
        :aria-label="`${label} color picker`"
        @input="handleColorInput"
      />
      <Input
        class="h-7 w-28 font-mono text-xs"
        :model-value="modelValue"
        :disabled="disabled"
        :aria-label="`${label} hex value`"
        :aria-invalid="!isValid"
        spellcheck="false"
        @update:model-value="handleTextInput"
      />
      <span
        v-if="showContrastWarning && contrastRatioValue !== null"
        class="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
        role="note"
        :aria-label="`Low contrast: ${contrastRatioValue.toFixed(1)} to 1`"
      >
        <AppIcon name="triangle-alert" class="h-3 w-3" />
        Low contrast ({{ contrastRatioValue.toFixed(1) }}:1)
      </span>
      <span
        v-else-if="contrastRatioValue !== null && contrastAgainst"
        class="text-xs text-muted-foreground"
      >
        {{ contrastRatioValue.toFixed(1) }}:1
      </span>
    </div>
    <p v-if="!isValid" class="text-xs text-destructive" role="alert">
      Enter a hex color like #1a1a1a.
    </p>
  </div>
</template>
