import { toast } from 'vue-sonner'
import type { VixlDuplicateTabBehavior } from '@/types/vixl/vixl-settings'
import useVixlConfig from '@/composables/use-vixl-config'
import { findTab } from './helpers'
import {
  duplicateDialog,
  duplicateDialogOpen,
  duplicateDialogTabType,
  type DuplicateTabResolution,
  type ResolveWorkbenchTabOpenParams,
} from './state'

export const resolveWorkbenchTabOpen = async (
  params: ResolveWorkbenchTabOpenParams,
): Promise<DuplicateTabResolution> => {
  const existing = findTab(params.predicate)
  if (!existing) {
    return 'new'
  }

  const config = useVixlConfig()
  const behavior =
    config.effectiveSettings.value['workbench.duplicateTabBehavior'] ?? 'ask'

  if (behavior === 'open-existing') {
    return 'existing'
  }
  if (behavior === 'open-new') {
    return 'new'
  }

  if (duplicateDialogOpen.value) {
    return 'new'
  }

  duplicateDialogTabType.value = params.type
  duplicateDialogOpen.value = true

  return new Promise<DuplicateTabResolution>((resolve) => {
    duplicateDialog.resolve = resolve
  })
}

export const confirmDuplicateTabChoice = async (
  choice: DuplicateTabResolution,
  dontAskAgain: boolean,
): Promise<void> => {
  if (!duplicateDialog.resolve) {
    return
  }

  const resolve = duplicateDialog.resolve
  duplicateDialog.resolve = null
  duplicateDialogOpen.value = false
  resolve(choice)

  if (!dontAskAgain) {
    return
  }

  const behavior: VixlDuplicateTabBehavior =
    choice === 'existing' ? 'open-existing' : 'open-new'

  try {
    const config = useVixlConfig()
    await config.updateSetting('personal', 'workbench.duplicateTabBehavior', behavior)
  } catch (error) {
    toast.error('Failed to save preference', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

export const cancelDuplicateTabDialog = (): void => {
  if (!duplicateDialog.resolve) {
    duplicateDialogOpen.value = false
    return
  }

  const resolve = duplicateDialog.resolve
  duplicateDialog.resolve = null
  duplicateDialogOpen.value = false
  resolve('new')
}
