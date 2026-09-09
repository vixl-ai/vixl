<script setup lang="ts">
import AppearanceThemeEditor from './AppearanceThemeEditor.vue'
import type {
  VixlThemeCanvas,
  VixlThemeDefinition,
  VixlThemeGlass,
  VixlThemeIconAppearance,
  VixlThemeSemanticTokens,
  VixlThemeTypography,
  VixlThemeVariantKind,
} from '@/types/appearance/theme'

/**
 * Thin host for the draft theme editor inside the Appearance section: owns
 * nothing — it forwards every draft mutation and Apply/Cancel/reset intent to
 * the section, which persists changes only on Apply.
 */
defineProps<{
  draft: VixlThemeDefinition
  editingVariant: VixlThemeVariantKind
  isDirty: boolean
  isDraftValid: boolean
  applying?: boolean
}>()

const emit = defineEmits<{
  rename: [value: string]
  'set-variant': [variant: VixlThemeVariantKind]
  'set-token': [key: keyof VixlThemeSemanticTokens, value: string]
  'set-typography': [patch: Partial<VixlThemeTypography>]
  'set-canvas': [canvas: VixlThemeCanvas]
  'set-glass': [glass: VixlThemeGlass]
  'set-icons': [icons: VixlThemeIconAppearance]
  'reset-variant': []
  'reset-section': [section: 'colors' | 'typography' | 'background' | 'glass' | 'icons']
  apply: []
  cancel: []
}>()
</script>

<template>
  <AppearanceThemeEditor
    :draft="draft"
    :editing-variant="editingVariant"
    :is-dirty="isDirty"
    :is-draft-valid="isDraftValid"
    :applying="applying"
    @rename="emit('rename', $event)"
    @set-variant="emit('set-variant', $event)"
    @set-token="(key, value) => emit('set-token', key, value)"
    @set-typography="emit('set-typography', $event)"
    @set-canvas="emit('set-canvas', $event)"
    @set-glass="emit('set-glass', $event)"
    @set-icons="emit('set-icons', $event)"
    @reset-variant="emit('reset-variant')"
    @reset-section="emit('reset-section', $event)"
    @apply="emit('apply')"
    @cancel="emit('cancel')"
  />
</template>
