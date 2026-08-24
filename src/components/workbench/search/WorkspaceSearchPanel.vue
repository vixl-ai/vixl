<script setup lang="ts">
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
import useWorkspaceSearch from '@/composables/workspace-search'
import type { GrepMatch } from '@/services/vixl/vixl-tauri'

const props = defineProps<{
  projectId: string
  projectRoot: string | null
}>()

const projectRootRef = toRef(props, 'projectRoot')

const {
  findQuery,
  replaceQuery,
  replaceExpanded,
  matchCase,
  matchWholeWord,
  useRegex,
  includeGlob,
  excludeGlob,
  pending,
  replacing,
  groups,
  resultCount,
  fileCount,
  summaryLabel,
  isGroupOpen,
  setGroupOpen,
  expandReplace,
  toggleReplaceExpanded,
  replaceOne,
  replaceMatch,
  replaceFile,
  replaceAll,
} = useWorkspaceSearch(projectRootRef)

const formRef = ref<{
  focusFind: () => void
  focusReplace: () => void
} | null>(null)

const confirmReplaceAllOpen = ref(false)

const hasQuery = computed(() => findQuery.value.trim().length > 0)

const replaceAllDescription = computed(() => {
  const results = resultCount.value
  const files = fileCount.value
  const occurrenceWord = results === 1 ? 'occurrence' : 'occurrences'
  const fileWord = files === 1 ? 'file' : 'files'
  return `Replace ${results} ${occurrenceWord} across ${files} ${fileWord}?`
})

const focusFind = (expandReplaceField = false): void => {
  if (expandReplaceField) {
    expandReplace()
  }
  nextTick(() => {
    formRef.value?.focusFind()
  })
}

const handleReplaceOne = async (): Promise<void> => {
  await replaceOne()
}

const handleReplaceAllRequest = (): void => {
  if (replacing.value || resultCount.value === 0) {
    return
  }
  confirmReplaceAllOpen.value = true
}

const handleConfirmReplaceAll = async (): Promise<void> => {
  confirmReplaceAllOpen.value = false
  await replaceAll()
}

const handleReplaceHit = async (hit: GrepMatch): Promise<void> => {
  await replaceMatch(hit)
}

const handleReplaceFile = async (path: string): Promise<void> => {
  await replaceFile(path)
}

defineExpose({
  focusFind,
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden font-sans text-[13px]">
    <WorkspaceSearchForm
      ref="formRef"
      v-model:find-query="findQuery"
      v-model:replace-query="replaceQuery"
      v-model:match-case="matchCase"
      v-model:match-whole-word="matchWholeWord"
      v-model:use-regex="useRegex"
      v-model:include-glob="includeGlob"
      v-model:exclude-glob="excludeGlob"
      :replace-expanded="replaceExpanded"
      :replacing="replacing"
      @toggle-replace="toggleReplaceExpanded"
      @replace-one="handleReplaceOne"
      @replace-all="handleReplaceAllRequest"
    />
    <WorkspaceSearchResults
      :project-id="projectId"
      :groups="groups"
      :pending="pending"
      :replacing="replacing"
      :replace-expanded="replaceExpanded"
      :summary-label="summaryLabel"
      :has-query="hasQuery"
      :is-group-open="isGroupOpen"
      :set-group-open="setGroupOpen"
      @replace-hit="handleReplaceHit"
      @replace-file="handleReplaceFile"
    />

    <AlertDialog v-model:open="confirmReplaceAllOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace all</AlertDialogTitle>
          <AlertDialogDescription>
            {{ replaceAllDescription }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="replacing">Cancel</AlertDialogCancel>
          <Button
            type="button"
            :disabled="replacing"
            @click="handleConfirmReplaceAll"
          >
            Confirm
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
