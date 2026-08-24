<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/shadcn/ui/alert-dialog'
import { Button } from '@/components/shadcn/ui/button'
import { Checkbox } from '@/components/shadcn/ui/checkbox'
import { Label } from '@/components/shadcn/ui/label'
import useWorkbenchStore from '@/composables/use-workbench-store'
import type { WorkbenchTabType } from '@/types/workbench/workbench-tab'

const workbench = useWorkbenchStore()
const dontAskAgain = ref(false)

const tabTypeLabels: Record<
  Exclude<WorkbenchTabType, 'plan' | 'studio' | 'agent-shell' | 'browser'>,
  string
> = {
  editor: 'Editor',
  terminal: 'Terminal',
  changes: 'Changes',
}

const tabLabel = computed(() => tabTypeLabels[workbench.duplicateDialogTabType.value])

watch(
  () => workbench.duplicateDialogOpen.value,
  (open) => {
    if (open) {
      dontAskAgain.value = false
    }
  },
)

const handleOpenExisting = async (): Promise<void> => {
  await workbench.confirmDuplicateTabChoice('existing', dontAskAgain.value)
}

const handleOpenNew = async (): Promise<void> => {
  await workbench.confirmDuplicateTabChoice('new', dontAskAgain.value)
}

const handleOpenChange = (open: boolean): void => {
  if (!open) {
    workbench.cancelDuplicateTabDialog()
  }
}
</script>

<template>
  <AlertDialog
    :open="workbench.duplicateDialogOpen.value"
    @update:open="handleOpenChange"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Duplicate tab</AlertDialogTitle>
        <AlertDialogDescription>
          A {{ tabLabel }} tab is already open for this project. Open the existing tab or create a
          new one?
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div class="flex items-center gap-2">
        <Checkbox
          id="duplicate-tab-dont-ask"
          v-model="dontAskAgain"
        />
        <Label for="duplicate-tab-dont-ask">Don't ask me again</Label>
      </div>
      <AlertDialogFooter>
        <Button
          variant="outline"
          @click="handleOpenExisting"
        >
          Open existing
        </Button>
        <Button @click="handleOpenNew">
          Open new tab
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
