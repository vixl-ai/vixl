<script setup lang="ts">
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'

defineProps<{
  id: string
  label: string
  modelValue: number
  min: number
  max: number
  step?: number
  unit: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const handleSlider = (event: Event): void => {
  emit('update:modelValue', Number((event.target as HTMLInputElement).value))
}

const handleNumeric = (value: string | number): void => {
  emit('update:modelValue', Number(value))
}
</script>

<template>
  <div class="flex items-center gap-3">
    <Label :for="id" class="min-w-36 text-sm">
      {{ label }}
    </Label>
    <input
      :id="id"
      type="range"
      :min="min"
      :max="max"
      :step="step ?? 1"
      class="h-2 w-32 accent-current"
      :value="modelValue"
      :disabled="disabled"
      :aria-label="`${label} range control`"
      @input="handleSlider"
    />
    <Input
      class="h-7 w-16"
      type="number"
      :min="min"
      :max="max"
      :step="step ?? 1"
      :model-value="modelValue"
      :disabled="disabled"
      :aria-label="`${label} numeric value`"
      @update:model-value="handleNumeric"
    />
    <span class="text-xs text-muted-foreground">{{ unit }}</span>
  </div>
</template>
