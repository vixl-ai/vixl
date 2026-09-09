<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed, ref } from 'vue'
import type { AggregatedTurnFileChange } from '@/types/harness/file-checkpoint'
import {
  CommitFile,
  CommitFileAdditions,
  CommitFileDeletions,
  CommitFilePath,
  CommitFiles,
  CommitFileStatus,
} from '@/components/ai-elements/commit'
import { Button } from '@/components/shadcn/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/shadcn/ui/alert-dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'
import { summarizeMutationCounts } from '@/services/harness/restore-file-checkpoints'

const props = defineProps<{
  changes: AggregatedTurnFileChange[]
  restoreEnabled?: boolean
}>()

const emit = defineEmits<{
  restore: []
}>()

const open = ref(false)
const confirmOpen = ref(false)

const totals = computed(() => {
  let additions = 0
  let deletions = 0
  for (const change of props.changes) {
    additions += change.additions
    deletions += change.deletions
  }
  return { additions, deletions }
})

const counts = computed(() => summarizeMutationCounts(props.changes))

const statusFor = (
  operation: AggregatedTurnFileChange['operation'],
): 'added' | 'modified' | 'deleted' | 'renamed' => {
  if (operation === 'create') return 'added'
  if (operation === 'delete') return 'deleted'
  if (operation === 'rename') return 'renamed'
  return 'modified'
}

const handleRestoreClick = (): void => {
  confirmOpen.value = true
}

const handleConfirmRestore = (): void => {
  confirmOpen.value = false
  emit('restore')
}
</script>

<template>
  <div v-if="changes.length > 0" class="w-full min-w-0 max-w-full">
    <Collapsible v-model:open="open" class="w-full min-w-0">
      <div class="flex w-full max-w-full items-center gap-1">
        <CollapsibleTrigger
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-0.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <AppIcon
            name="chevron-right"
            class="size-3.5 shrink-0 transition-transform"
            :class="open ? 'rotate-90' : ''"
          />
          <span class="shrink-0">
            {{ changes.length }} file{{ changes.length === 1 ? '' : 's' }} changed
          </span>
          <span
            v-if="totals.additions > 0 || totals.deletions > 0"
            class="flex shrink-0 items-center gap-1.5 tabular-nums"
          >
            <CommitFileAdditions
              :count="totals.additions"
              class="inline-flex items-center gap-0.5 text-[11px]"
            />
            <CommitFileDeletions
              :count="totals.deletions"
              class="inline-flex items-center gap-0.5 text-[11px]"
            />
          </span>
        </CollapsibleTrigger>
        <Tooltip v-if="restoreEnabled">
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-7 shrink-0 text-muted-foreground"
              aria-label="Restore files"
              @click="handleRestoreClick"
            >
              <AppIcon name="undo" class="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Restore files</TooltipContent>
        </Tooltip>
      </div>
      <CollapsibleContent class="mt-1">
        <CommitFiles>
          <CommitFile v-for="change in changes" :key="change.path">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <CommitFileStatus :status="statusFor(change.operation)" />
              <CommitFilePath class="truncate">
                {{ change.path }}
              </CommitFilePath>
            </div>
            <span class="flex shrink-0 items-center gap-1.5 tabular-nums">
              <CommitFileAdditions
                v-if="change.additions > 0"
                :count="change.additions"
                class="inline-flex items-center gap-0.5 text-[11px]"
              />
              <CommitFileDeletions
                v-if="change.deletions > 0"
                :count="change.deletions"
                class="inline-flex items-center gap-0.5 text-[11px]"
              />
            </span>
          </CommitFile>
        </CommitFiles>
      </CollapsibleContent>
    </Collapsible>

    <AlertDialog :open="confirmOpen" @update:open="confirmOpen = $event">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revert files from this turn?</AlertDialogTitle>
          <AlertDialogDescription>
            This will revert {{ counts.files }} file{{ counts.files === 1 ? '' : 's' }}
            to the state before this turn
            <template v-if="counts.created > 0">
              ({{ counts.created }} created file{{ counts.created === 1 ? '' : 's' }} removed)
            </template>
            and discard the conversation after the preceding message. Manual edits on those paths
            will also be overwritten.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" @click="handleConfirmRestore">
            Revert files
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
