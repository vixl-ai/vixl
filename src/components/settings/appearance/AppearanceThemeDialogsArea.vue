<script setup lang="ts">
import AppearanceThemeDialogs from './AppearanceThemeDialogs.vue'
import AppearanceThemeImportDialog from './AppearanceThemeImportDialog.vue'
import type { describeThemeFile } from '@/services/appearance/theme-file-utils'

/**
 * Confirmation/rename/delete dialogs plus the import-summary dialog for the
 * Appearance section, grouped so the section itself stays focused on state.
 */
defineProps<{
  deleteThemeName: string
  renameOpen: boolean
  renameValue: string
  deleteOpen: boolean
  cancelOpen: boolean
  importOpen: boolean
  importSummary: ReturnType<typeof describeThemeFile> | null
  renamedFromId: string | null
  importActivate: boolean
  importing: boolean
}>()

const emit = defineEmits<{
  'update:rename-open': [open: boolean]
  'update:rename-value': [value: string]
  'update:delete-open': [open: boolean]
  'update:cancel-open': [open: boolean]
  'update:import-open': [open: boolean]
  'update:import-activate': [value: boolean]
  'confirm-rename': []
  'confirm-delete': []
  discard: []
  'confirm-import': []
}>()
</script>

<template>
  <!-- Confirmation and rename dialogs -->
  <AppearanceThemeDialogs
    :theme-name="deleteThemeName"
    :rename-open="renameOpen"
    :rename-value="renameValue"
    :delete-open="deleteOpen"
    :cancel-open="cancelOpen"
    @update:rename-open="emit('update:rename-open', $event)"
    @update:rename-value="emit('update:rename-value', $event)"
    @update:delete-open="emit('update:delete-open', $event)"
    @update:cancel-open="emit('update:cancel-open', $event)"
    @confirm-rename="emit('confirm-rename')"
    @confirm-delete="emit('confirm-delete')"
    @discard="emit('discard')"
  />

  <!-- Import summary and confirmation -->
  <AppearanceThemeImportDialog
    :open="importOpen"
    :summary="importSummary"
    :renamed-from-id="renamedFromId"
    :activate="importActivate"
    :importing="importing"
    @update:open="emit('update:import-open', $event)"
    @update:activate="emit('update:import-activate', $event)"
    @confirm="emit('confirm-import')"
  />
</template>
