<script setup lang="ts">
import { computed } from 'vue'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import { NativeSelect } from '@/components/shadcn/ui/native-select'
import {
  clampFontSize,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  MONO_FONT_PRESETS,
  UI_FONT_PRESETS,
  typographyPresetValue,
} from './appearance-ui'
import type { VixlThemeTypography } from '@/types/appearance/theme'

const props = defineProps<{
  typography: VixlThemeTypography
  disabled?: boolean
}>()

const emit = defineEmits<{
  update: [patch: Partial<VixlThemeTypography>]
}>()

const uiPresetValue = computed(() => typographyPresetValue(props.typography, 'ui'))
const monoPresetValue = computed(() => typographyPresetValue(props.typography, 'mono'))

const handleUiFont = (event: Event): void => {
  const [family, fallbacks = ''] = (event.target as HTMLSelectElement).value.split('|')
  emit('update', { uiFontFamily: family, uiFontFallbacks: fallbacks.split(',') })
}

const handleMonoFont = (event: Event): void => {
  const [family, fallbacks = ''] = (event.target as HTMLSelectElement).value.split('|')
  emit('update', { monoFontFamily: family, monoFontFallbacks: fallbacks.split(',') })
}

const handleUiFontSize = (value: string | number): void => {
  emit('update', { uiFontSize: clampFontSize(Number(value)) })
}

const handleEditorFontSize = (value: string | number): void => {
  emit('update', { editorFontSize: clampFontSize(Number(value)) })
}
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="space-y-1">
      <Label for="appearance-ui-font">UI font family</Label>
      <NativeSelect
        id="appearance-ui-font"
        :model-value="uiPresetValue"
        :disabled="disabled"
        aria-label="UI font family"
        @change="handleUiFont"
      >
        <option
          v-for="preset in UI_FONT_PRESETS"
          :key="preset.family"
          :value="`${preset.family}|${preset.fallbacks.join(',')}`"
        >
          {{ preset.label }}
        </option>
      </NativeSelect>
    </div>
    <div class="space-y-1">
      <Label for="appearance-mono-font">Monospace font family</Label>
      <NativeSelect
        id="appearance-mono-font"
        :model-value="monoPresetValue"
        :disabled="disabled"
        aria-label="Monospace font family"
        @change="handleMonoFont"
      >
        <option
          v-for="preset in MONO_FONT_PRESETS"
          :key="preset.family"
          :value="`${preset.family}|${preset.fallbacks.join(',')}`"
        >
          {{ preset.label }}
        </option>
      </NativeSelect>
    </div>
    <div class="space-y-1">
      <Label for="appearance-ui-font-size">UI font size (px)</Label>
      <Input
        id="appearance-ui-font-size"
        type="number"
        :min="MIN_FONT_SIZE"
        :max="MAX_FONT_SIZE"
        :step="0.5"
        :model-value="typography.uiFontSize"
        :disabled="disabled"
        @update:model-value="handleUiFontSize"
      />
      <p class="text-xs text-muted-foreground">{{ MIN_FONT_SIZE }}-{{ MAX_FONT_SIZE }} px</p>
    </div>
    <div class="space-y-1">
      <Label for="appearance-editor-font-size">Editor font size (px)</Label>
      <Input
        id="appearance-editor-font-size"
        type="number"
        :min="MIN_FONT_SIZE"
        :max="MAX_FONT_SIZE"
        :step="0.5"
        :model-value="typography.editorFontSize"
        :disabled="disabled"
        @update:model-value="handleEditorFontSize"
      />
      <p class="text-xs text-muted-foreground">{{ MIN_FONT_SIZE }}-{{ MAX_FONT_SIZE }} px</p>
    </div>
  </div>
</template>
