<script setup lang="ts">
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type RulesKind = 'agents-md' | 'rules'

const view = defineModel<RulesKind>({ required: true })

const handleChange = (value: unknown): void => {
  if (value === 'agents-md' || value === 'rules') {
    view.value = value
  }
}
</script>

<template>
  <Select :model-value="view" @update:model-value="handleChange">
    <SelectTrigger size="sm" aria-label="Rules view">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="agents-md">AGENTS.md</SelectItem>
      <SelectItem value="rules">Rules</SelectItem>
    </SelectContent>
  </Select>
</template>
