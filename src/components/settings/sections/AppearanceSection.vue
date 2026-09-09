<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import SettingsSectionScroll from '@/components/settings/SettingsSectionScroll.vue'
import useVixlConfig from '@/composables/use-vixl-config'
import useAppearance from '@/composables/use-appearance'
import formatUnknownError from '@/utils/format-unknown-error'
import AppearanceModeSelect from '@/components/settings/appearance/AppearanceModeSelect.vue'
import AppearanceEditorPanel from '@/components/settings/appearance/AppearanceEditorPanel.vue'
import AppearanceThemeDialogsArea from '@/components/settings/appearance/AppearanceThemeDialogsArea.vue'
import AppearanceThemePicker from '@/components/settings/appearance/AppearanceThemePicker.vue'
import { isBuiltInTheme } from '@/components/settings/appearance/appearance-ui'
import { useAppearanceGallery } from '@/components/settings/appearance/use-appearance-gallery'
import {
  useAppearanceEditor,
  type AppearanceEditorSection,
} from '@/components/settings/appearance/use-appearance-editor'
import { useAppearanceThemes } from '@/components/settings/appearance/use-appearance-themes'
import { useAppearanceSharing } from '@/components/settings/appearance/use-appearance-sharing'

const config = useVixlConfig()
const runtime = useAppearance()
const {
  themes: savedThemes,
  activeTheme,
  selectedThemeId,
  generateThemeId,
  saveTheme,
  removeTheme,
  renameTheme,
  setActiveTheme,
} = useAppearanceThemes()
const {
  draft,
  editingVariant,
  mode: editorMode,
  isEditing,
  isDirty,
  isDraftValid,
  beginCreate,
  beginEdit,
  beginDuplicate,
  cancel: cancelDraft,
  setVariant,
  rename,
  setToken,
  setTypography,
  setCanvas,
  setGlass,
  setIcons,
  resetVariant,
  resetSection,
} = useAppearanceEditor()

const renameOpen = ref(false)
const renameValue = ref('')
const deleteOpen = ref(false)
const cancelOpen = ref(false)
const applying = ref(false)

// Shareable-theme import/export (cancellation is always a silent no-op).
const {
  importOpen,
  importActivate,
  pendingImport,
  importing,
  exporting,
  closeImport,
  handleImport,
  handleImportConfirm,
  handleExport,
} = useAppearanceSharing({
  existingThemeIds: () => savedThemes.value.map((entry) => entry.id),
  // Built-ins are exportable (read-only, canonical v2); a missing target only
  // occurs when nothing valid is selected.
  exportTarget: () => selectedTheme.value,
})

const theme = computed(() => config.effectiveSettings.value['appearance.theme'] ?? 'system')

const selectedTheme = computed(() => activeTheme.value)
const selectedIsBuiltIn = computed(() => isBuiltInTheme(selectedTheme.value))

const startEditing = (mode: 'create' | 'edit' | 'duplicate'): void => {
  cancelPreview()
  // In System mode the editor targets the currently resolved variant.
  const variant = runtime.effectiveAppearance.value.variant
  const id = generateThemeId(
    mode === 'duplicate' ? `${selectedTheme.value.name} copy` : 'Untitled theme',
  )
  if (mode === 'create') {
    beginCreate(selectedTheme.value, id, variant)
  } else if (mode === 'duplicate') {
    beginDuplicate(selectedTheme.value, id, variant)
  } else {
    beginEdit(selectedTheme.value, id, variant)
  }
}

// Visual theme gallery: grouping, selection, preview/apply, customize, delete
// targeting, and the draft-editor live-preview channel (stale-preview cleanup).
const {
  galleryGroups,
  previewThemeId,
  previewingTheme,
  previewVariant,
  selectTheme: handleSelectTheme,
  setMode,
  togglePreview,
  cancelPreview,
  useTheme: handleGalleryUse,
  applyPreviewedTheme,
  customizeTheme: handleGalleryCustomize,
  editTheme: handleGalleryEdit,
  requestDelete: requestDeleteTarget,
  deleteTargetId,
  pendingDeleteTheme,
} = useAppearanceGallery({
  savedThemes: () => savedThemes.value,
  selectedTheme: () => selectedTheme.value,
  isEditing,
  runtime,
  setActiveTheme,
  setThemeMode: (value) => config.setTheme('personal', value),
  resolvedVariant: () => runtime.effectiveAppearance.value.variant,
  newThemeId: (name) => generateThemeId(name),
  beginDuplicate,
  beginEdit,
  beginCreate,
  draft: () => draft.value,
  editingVariant: () => editingVariant.value,
  cancelDraft,
})

const requestDelete = (id: string): void => {
  requestDeleteTarget(id)
  if (pendingDeleteTheme.value !== null) {
    deleteOpen.value = true
  }
}

const openRename = (): void => {
  renameValue.value = selectedTheme.value.name
  renameOpen.value = true
}

const handleResetVariant = (): void => {
  resetVariant()
  toast.success(`Reset ${editingVariant.value} variant to Vixl defaults`)
}

const handleResetSection = (section: AppearanceEditorSection): void => {
  resetSection(section)
  toast.success(`Reset ${section} to Vixl defaults (${editingVariant.value} variant)`)
}

const handleRenameConfirm = async (): Promise<void> => {
  const nextName = renameValue.value.trim()
  if (!nextName) {
    toast.error('Theme name is required')
    return
  }
  try {
    if (!(await renameTheme(selectedTheme.value.id, nextName))) {
      toast.error('Failed to rename theme')
      return
    }
    renameOpen.value = false
    toast.success('Theme renamed')
  } catch (error) {
    toast.error('Failed to rename theme', {
      description: formatUnknownError(error),
    })
  }
}

const handleDelete = async (): Promise<void> => {
  const target = pendingDeleteTheme.value
  if (!target) {
    deleteOpen.value = false
    return
  }
  const wasActive = target.id === selectedThemeId.value
  try {
    if (!(await removeTheme(target.id))) {
      toast.error('Failed to delete theme')
      return
    }
    deleteOpen.value = false
    deleteTargetId.value = null
    if (previewThemeId.value === target.id) {
      cancelPreview()
    }
    toast.success(wasActive ? 'Theme deleted; reverted to Vixl Default' : 'Theme deleted')
  } catch (error) {
    toast.error('Failed to delete theme', {
      description: formatUnknownError(error),
    })
  }
}

const handleApply = async (): Promise<void> => {
  if (!draft.value || !isDraftValid.value) {
    toast.error('Theme is invalid', {
      description: 'Fix invalid color values before saving.',
    })
    return
  }
  applying.value = true
  try {
    const wasNew = editorMode.value !== 'edit'
    if (!(await saveTheme(draft.value, { activate: true }))) {
      toast.error('Failed to save theme')
      return
    }
    cancelDraft()
    toast.success(wasNew ? 'Theme created and applied' : 'Theme saved and applied')
  } catch (error) {
    toast.error('Failed to save theme', {
      description: formatUnknownError(error),
    })
  } finally {
    applying.value = false
  }
}

const handleCancelRequest = (): void => {
  if (isDirty.value) {
    cancelOpen.value = true
    return
  }
  cancelDraft()
}

const handleDiscard = (): void => {
  cancelOpen.value = false
  cancelDraft()
}
</script>

<template>
  <SettingsSectionScroll title="Appearance">
    <div class="space-y-8">
      <!-- Color mode (moved from General so there is a single control) -->
      <AppearanceModeSelect :mode="theme" @select="setMode" />

      <!-- Theme selection, gallery, and management -->
      <AppearanceThemePicker
        :selected-theme-id="selectedThemeId"
        :selected-is-built-in="selectedIsBuiltIn"
        :importing="importing"
        :exporting="exporting"
        :built-in="galleryGroups.builtIn"
        :custom="galleryGroups.custom"
        :previewing-id="previewThemeId"
        :editing="isEditing"
        :previewing-theme-name="previewingTheme?.name ?? null"
        :preview-variant="previewVariant"
        @select="handleSelectTheme"
        @create="startEditing('create')"
        @edit="startEditing('edit')"
        @duplicate="startEditing('duplicate')"
        @rename="openRename"
        @delete="requestDelete(selectedTheme.id)"
        @export="handleExport"
        @import="handleImport"
        @gallery-use="handleGalleryUse"
        @gallery-preview="togglePreview"
        @gallery-customize="handleGalleryCustomize"
        @gallery-edit="handleGalleryEdit"
        @gallery-delete="requestDelete"
        @preview-apply="applyPreviewedTheme"
        @preview-exit="cancelPreview"
      />

      <!-- Theme editor (draft; nothing persists until Apply) -->
      <AppearanceEditorPanel
        v-if="isEditing && draft"
        :draft="draft"
        :editing-variant="editingVariant"
        :is-dirty="isDirty"
        :is-draft-valid="isDraftValid"
        :applying="applying"
        @rename="rename"
        @set-variant="setVariant"
        @set-token="setToken"
        @set-typography="setTypography"
        @set-canvas="setCanvas"
        @set-glass="setGlass"
        @set-icons="setIcons"
        @reset-variant="handleResetVariant"
        @reset-section="handleResetSection"
        @apply="handleApply"
        @cancel="handleCancelRequest"
      />
    </div>

    <!-- Confirmation, rename, delete, and import dialogs -->
    <AppearanceThemeDialogsArea
      :delete-theme-name="pendingDeleteTheme?.name ?? selectedTheme.name"
      :rename-open="renameOpen"
      :rename-value="renameValue"
      :delete-open="deleteOpen"
      :cancel-open="cancelOpen"
      :import-open="importOpen"
      :import-summary="pendingImport?.summary ?? null"
      :renamed-from-id="pendingImport?.renamedFromId ?? null"
      :import-activate="importActivate"
      :importing="importing"
      @update:rename-open="(open: boolean) => (renameOpen = open)"
      @update:rename-value="(value: string) => (renameValue = value)"
      @update:delete-open="(open: boolean) => (deleteOpen = open)"
      @update:cancel-open="(open: boolean) => (cancelOpen = open)"
      @update:import-open="(open: boolean) => (open ? (importOpen = true) : closeImport())"
      @update:import-activate="(value: boolean) => (importActivate = value)"
      @confirm-rename="handleRenameConfirm"
      @confirm-delete="handleDelete"
      @discard="handleDiscard"
      @confirm-import="handleImportConfirm"
    />
  </SettingsSectionScroll>
</template>
