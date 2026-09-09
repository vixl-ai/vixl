import { ref } from 'vue'
import { toast } from 'vue-sonner'
import useVixlConfig from '@/composables/use-vixl-config'
import formatUnknownError from '@/utils/format-unknown-error'
import {
  exportThemeToFile,
  importThemeFromFile,
  themeDefinitionToThemeFilePayload,
} from '@/services/appearance/theme-sharing'
import { persistThemeImport } from '@/services/appearance/theme-persistence'
import type { ImportedTheme } from '@/services/appearance/theme-sharing'
import type { VixlThemeDefinition } from '@/types/appearance/theme'

/**
 * Shareable-theme import/export wiring for the Appearance settings section.
 *
 * Import: pick and validate a file, then show a summary confirmation before
 * anything is written. Dialog cancellation is a silent no-op; validation,
 * filesystem, and persistence failures surface as toasts without partially
 * changing the active theme or library.
 *
 * Export: canonicalize the selected saved theme and write it via a save
 * dialog. Cancellation is also a silent no-op.
 */
export const useAppearanceSharing = (options: {
  /** Current persisted theme ids, for import collision handling. */
  existingThemeIds: () => readonly string[]
  /** The saved theme to export, or `null` when the built-in theme is active. */
  exportTarget: () => VixlThemeDefinition | null
}) => {
  const config = useVixlConfig()

  const importOpen = ref(false)
  const importActivate = ref(true)
  const pendingImport = ref<ImportedTheme | null>(null)
  const importing = ref(false)
  const exporting = ref(false)

  const closeImport = (): void => {
    importOpen.value = false
    pendingImport.value = null
  }

  const handleImport = async (): Promise<void> => {
    importing.value = true
    try {
      const result = await importThemeFromFile({
        existingThemeIds: new Set(options.existingThemeIds()),
      })
      if (result.status === 'canceled') {
        return
      }
      if (result.status === 'error') {
        toast.error('Failed to import theme', { description: result.message })
        return
      }
      pendingImport.value = result
      importActivate.value = true
      importOpen.value = true
    } catch (error) {
      toast.error('Failed to import theme', {
        description: formatUnknownError(error),
      })
    } finally {
      importing.value = false
    }
  }

  /**
   * Confirmation step: persist the imported theme and its optional activation
   * atomically, then refresh so the library and preview reflect the write.
   */
  const handleImportConfirm = async (): Promise<void> => {
    const pending = pendingImport.value
    if (!pending) {
      return
    }
    importing.value = true
    try {
      await persistThemeImport({
        importedTheme: pending.theme,
        activate: importActivate.value,
      })
      // Re-read settings so the library select and runtime pick up the write.
      await config.refreshAll()
      closeImport()
      toast.success(
        pending.renamedFromId === null
          ? `Imported theme "${pending.theme.name}"`
          : `Imported theme "${pending.theme.name}" as "${pending.theme.id}"`,
        {
          description: importActivate.value ? 'The theme is now active.' : undefined,
        },
      )
    } catch (error) {
      toast.error('Failed to save imported theme', {
        description: formatUnknownError(error),
      })
    } finally {
      importing.value = false
    }
  }

  const handleExport = async (): Promise<void> => {
    const target = options.exportTarget()
    if (!target) {
      return
    }
    exporting.value = true
    try {
      const result = await exportThemeToFile(themeDefinitionToThemeFilePayload(target))
      if (result.status === 'canceled') {
        return
      }
      if (result.status === 'error') {
        toast.error('Failed to export theme', { description: result.message })
        return
      }
      toast.success(`Exported theme "${result.theme.name}"`, {
        description: result.path,
      })
    } catch (error) {
      toast.error('Failed to export theme', {
        description: formatUnknownError(error),
      })
    } finally {
      exporting.value = false
    }
  }

  return {
    importOpen,
    importActivate,
    pendingImport,
    importing,
    exporting,
    closeImport,
    handleImport,
    handleImportConfirm,
    handleExport,
  }
}
