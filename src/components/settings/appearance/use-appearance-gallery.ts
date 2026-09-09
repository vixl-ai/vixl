import { computed, onUnmounted, ref, watch, type ComputedRef } from 'vue'
import { toast } from 'vue-sonner'
import { groupGalleryThemes, type GalleryTheme } from './appearance-gallery-ui'
import { isBuiltInTheme } from './appearance-ui'
import { BUNDLED_THEMES } from '@/constants/appearance/built-in-theme-registry'
import formatUnknownError from '@/utils/format-unknown-error'
import { BUILTIN_VIXL_THEME_ID } from '@/types/appearance/theme'
import type { VixlTheme } from '@/types/vixl/vixl-settings'
import type {
  VixlThemeDefinition,
  VixlThemeVariantKind,
} from '@/types/appearance/theme'

/**
 * State and flows for the visual theme gallery inside the Appearance section:
 * grouping, theme selection/color-mode persistence, the explicit card
 * preview/apply channel (built on the appearance runtime preview), built-in
 * customize/duplicate, the delete-target used by the confirmation dialog, and
 * the draft-editor live-preview sync. Pure orchestration — no persistence of
 * drafts here.
 */

type PreviewRuntime = {
  updatePreview: (draft: {
    theme: VixlThemeDefinition
    variant: VixlThemeVariantKind
  }) => void
  cancelPreview: () => void
  isPreviewing?: { value: boolean }
  effectiveAppearance: ComputedRef<{ variant: VixlThemeVariantKind }>
}

export type AppearanceGalleryOptions = {
  savedThemes: () => VixlThemeDefinition[]
  selectedTheme: () => VixlThemeDefinition
  isEditing: ComputedRef<boolean>
  runtime: PreviewRuntime
  setActiveTheme: (id: string | null) => Promise<void>
  setThemeMode: (value: VixlTheme) => Promise<void>
  /** Resolved variant to target in System mode (OS-following). */
  resolvedVariant: () => VixlThemeVariantKind
  newThemeId: (name: string) => string
  beginDuplicate: (
    theme: VixlThemeDefinition,
    id: string,
    variant: VixlThemeVariantKind,
  ) => void
  beginEdit: (theme: VixlThemeDefinition, id: string, variant: VixlThemeVariantKind) => void
  beginCreate: (theme: VixlThemeDefinition, id: string, variant: VixlThemeVariantKind) => void
  /** Editor draft sync (live preview + stale-preview cleanup). */
  draft: () => VixlThemeDefinition | null
  editingVariant: () => VixlThemeVariantKind
  cancelDraft: () => void
}

export const useAppearanceGallery = (options: AppearanceGalleryOptions) => {
  const {
    savedThemes,
    selectedTheme,
    isEditing,
    runtime,
    setActiveTheme,
    setThemeMode,
    resolvedVariant,
    newThemeId,
    beginDuplicate,
    beginEdit,
    beginCreate,
    draft,
    editingVariant,
    cancelDraft,
  } = options

  // Theme currently shown by the gallery's live preview (null = no preview).
  const previewThemeId = ref<string | null>(null)
  // Theme awaiting delete confirmation (toolbar or a gallery card).
  const deleteTargetId = ref<string | null>(null)

  const galleryGroups = computed(() => groupGalleryThemes(BUNDLED_THEMES, savedThemes()))

  const findTheme = (id: string): VixlThemeDefinition | null => {
    const entry: GalleryTheme | undefined = [
      ...galleryGroups.value.builtIn,
      ...galleryGroups.value.custom,
    ].find((candidate) => candidate.theme.id === id)
    return entry?.theme ?? null
  }

  const selectTheme = async (id: string): Promise<void> => {
    try {
      await setActiveTheme(id === BUILTIN_VIXL_THEME_ID ? null : id)
    } catch (error) {
      toast.error('Failed to switch theme', {
        description: formatUnknownError(error),
      })
    }
  }

  const setMode = async (value: VixlTheme): Promise<void> => {
    try {
      await setThemeMode(value)
    } catch (error) {
      toast.error('Failed to save mode', {
        description: formatUnknownError(error),
      })
    }
  }

  // In System mode the live preview follows the currently resolved OS variant.
  const previewVariant = computed(() => runtime.effectiveAppearance.value.variant)

  const previewingTheme = computed(() =>
    previewThemeId.value === null ? null : findTheme(previewThemeId.value),
  )

  const cancelPreview = (): void => {
    if (previewThemeId.value === null) {
      return
    }
    previewThemeId.value = null
    if (!isEditing.value) {
      runtime.cancelPreview()
    }
  }

  const togglePreview = (id: string): void => {
    if (previewThemeId.value === id) {
      cancelPreview()
      return
    }
    // The draft editor owns the runtime preview channel while it is open.
    if (isEditing.value) {
      return
    }
    const target = findTheme(id)
    if (!target) {
      return
    }
    previewThemeId.value = id
    runtime.updatePreview({ theme: target, variant: previewVariant.value })
  }

  const useTheme = async (id: string): Promise<void> => {
    const target = findTheme(id)
    await selectTheme(id)
    cancelPreview()
    if (target) {
      toast.success(`Theme applied: ${target.name}`)
    }
  }

  const applyPreviewedTheme = async (): Promise<void> => {
    const id = previewThemeId.value
    if (id !== null) {
      await useTheme(id)
    }
  }

  const startEditingFrom = (theme: VixlThemeDefinition, mode: 'edit' | 'duplicate'): void => {
    cancelPreview()
    const id = newThemeId(mode === 'duplicate' ? `${theme.name} copy` : 'Untitled theme')
    if (mode === 'duplicate') {
      beginDuplicate(theme, id, resolvedVariant())
    } else {
      beginEdit(theme, id, resolvedVariant())
    }
  }

  const customizeTheme = (id: string): void => {
    const target = findTheme(id)
    if (target) {
      startEditingFrom(target, 'duplicate')
    }
  }

  const editTheme = (id: string): void => {
    const target = findTheme(id)
    if (target) {
      startEditingFrom(target, 'edit')
    }
  }

  /** Starts an editor draft from the currently selected theme. */
  const startEditingSelected = (mode: 'create' | 'edit' | 'duplicate'): void => {
    cancelPreview()
    const id = newThemeId(mode === 'duplicate' ? `${selectedTheme().name} copy` : 'Untitled theme')
    if (mode === 'create') {
      beginCreate(selectedTheme(), id, resolvedVariant())
      return
    }
    startEditingFrom(selectedTheme(), mode)
  }

  const requestDelete = (id: string): void => {
    const target = findTheme(id) ?? (id === selectedTheme().id ? selectedTheme() : null)
    if (!target || isBuiltInTheme(target)) {
      return
    }
    deleteTargetId.value = id
  }

  const pendingDeleteTheme = computed(() => {
    const id = deleteTargetId.value
    if (id === null) {
      return null
    }
    return findTheme(id) ?? (id === selectedTheme().id ? selectedTheme() : null)
  })

  // Opening the editor takes over the preview channel; drop any card preview.
  watch(isEditing, (editing) => {
    if (editing && previewThemeId.value !== null) {
      previewThemeId.value = null
    }
  })

  // Live preview: experimental draft edits render immediately without
  // persisting; closing the editor never leaves stale preview state behind.
  watch(
    [draft, editingVariant],
    () => {
      if (draft()) {
        runtime.updatePreview({ theme: draft() as VixlThemeDefinition, variant: editingVariant() })
      } else if (runtime.isPreviewing) {
        runtime.cancelPreview()
      }
    },
    { deep: true },
  )

  onUnmounted(() => {
    if (draft()) {
      cancelDraft()
    }
    runtime.cancelPreview()
  })

  return {
    galleryGroups,
    previewThemeId,
    previewingTheme,
    previewVariant,
    selectTheme,
    setMode,
    togglePreview,
    cancelPreview,
    useTheme,
    applyPreviewedTheme,
    customizeTheme,
    editTheme,
    startEditingSelected,
    requestDelete,
    deleteTargetId,
    pendingDeleteTheme,
  }
}
