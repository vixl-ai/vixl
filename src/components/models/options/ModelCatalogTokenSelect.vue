<script setup lang="ts">
import { Label } from '@/components/shadcn/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatTokenCount } from '@/services/models/options'

const props = defineProps<{
  label: string
  modelValue?: number
  reportedMax: number
  values: number[]
}>()

const emit = defineEmits<{
  change: [value: number | undefined]
}>()

const selected = computed(() => {
  if (
    typeof props.modelValue === 'number' &&
    props.values.includes(props.modelValue)
  ) {
    return String(props.modelValue)
  }
  if (props.values.includes(props.reportedMax)) {
    return String(props.reportedMax)
  }
  const last = props.values[props.values.length - 1]
  return typeof last === 'number' ? String(last) : ''
})

const handleChange = (value: unknown): void => {
  if (typeof value !== 'string') {
    return
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || !props.values.includes(parsed)) {
    return
  }
  emit('change', parsed === props.reportedMax ? undefined : parsed)
}
</script>

<template>
  <div class="space-y-1.5">
    <Label class="text-xs font-normal">{{ label }}</Label>
    <Select :model-value="selected" @update:model-value="handleChange">
      <SelectTrigger size="sm" class="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="value in values"
          :key="value"
          :value="String(value)"
        >
          {{ formatTokenCount(value) }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
