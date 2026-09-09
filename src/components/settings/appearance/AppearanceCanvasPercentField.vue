<script setup lang="ts">
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'

defineProps<{
  id: string
  label: string
  modelValue: number
  disabled?: boolean
  /** Accessible label used on both the label element and the input. */
  ariaLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

/**
 * Labeled 0-100 percent numeric field for radial/conic gradient geometry.
 * Values are clamped by the owning layer editor on emit.
 */
</script>

<template>
  <div class="flex items-center gap-2">
    <Label :for="id" class="text-sm">{{ label }}</Label>
    <Input
      :id="id"
      class="h-7 w-20"
      type="number"
      :min="0"
      :max="100"
      :model-value="modelValue"
      :disabled="disabled"
      :aria-label="ariaLabel"
      @update:model-value="(value: string | number) => emit('update:modelValue', Number(value))"
    />
    <span class="text-xs text-muted-foreground">%</span>
  </div>
</template>
