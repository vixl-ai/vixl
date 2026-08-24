<script setup lang="ts">
import ModelsSearchModelSearchPicker from '@/components/models/search/ModelSearchPicker.vue'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { SettingsTab } from '@/composables/use-vixl-config'

withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    compact?: boolean
    scopeSettings?: VixlSettings
    placeholder?: string
    hideDisallowed?: boolean
    optionsTab?: SettingsTab
  }>(),
  {
    disabled: false,
    compact: false,
    hideDisallowed: false,
    optionsTab: 'personal',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const handleModelChange = (value: string): void => {
  emit('update:modelValue', value)
}
</script>

<template>
  <ModelsSearchModelSearchPicker
    :model-value="modelValue"
    :disabled="disabled"
    :compact="compact"
    :scope-settings="scopeSettings"
    :placeholder="placeholder"
    :hide-disallowed="hideDisallowed"
    :options-tab="optionsTab"
    @update:model-value="handleModelChange"
  />
</template>
