<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  FileCode,
  FileSearch,
  List,
  Replace,
  X,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/shadcn/ui/alert-dialog'
import { Button } from '@/components/shadcn/ui/button'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
} from '@/components/shadcn/ui/empty'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/shadcn/ui/resizable'
import { ScrollArea, ScrollBar } from '@/components/shadcn/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import type { EditorSidePaneMode } from '@/components/workbench/EditorSidePane.vue'
import WorkbenchEditorFileSearchDialog from '@/components/workbench/EditorFileSearchDialog.vue'
import WorkbenchEditorMarkdownPreview from '@/components/workbench/EditorMarkdownPreview.vue'
import WorkbenchEditorSidePane from '@/components/workbench/EditorSidePane.vue'
import WorkbenchMonacoEditor from '@/components/workbench/MonacoEditor.vue'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { fsReadFile, revealInFolder } from '@/services/vixl/vixl-tauri'
import type { EditorPayload, WorkbenchTab } from '@/types/workbench/workbench-tab'

type EditorMode = 'edit' | 'preview'

const props = defineProps<{
  tab: WorkbenchTab
}>()

const workbench = useWorkbenchStore()

const monacoRef = ref<InstanceType<typeof WorkbenchMonacoEditor> | null>(null)
const sidePaneRef = ref<{ openSearch: (expandReplace?: boolean) => void } | null>(null)
const editorMode = ref<EditorMode>('edit')
const fileContent = ref('')
const fileDirty = ref<Record<string, boolean>>({})
const closeConfirmOpen = ref(false)
const closeTargetPath = ref<string | null>(null)
const closeSaving = ref(false)
const fileSearchOpen = ref(false)
const sidePaneOpen = ref(true)
const sidePaneMode = ref<EditorSidePaneMode>('explorer')
const isNavigatingHistory = ref(false)
const pathHistory = ref<string[]>([])
const historyIndex = ref(-1)

const lineNumbers = ref(true)
const wordWrap = ref(false)
const autoSave = ref(false)
const formatOnSave = ref(false)

const editorPayload = computed(() => props.tab.payload as EditorPayload)

const diffView = computed(() => editorPayload.value.diffView === true)

const isActiveTab = computed(() => workbench.activeTabId.value === props.tab.id)

const handleToggleDiffView = (): void => {
  workbench.setEditorDiffView(props.tab.id, !diffView.value)
}

const openPaths = computed(() => {
  const payload = editorPayload.value
  if (payload.openPaths.length > 0) {
    return payload.openPaths
  }
  return payload.path ? [payload.path] : []
})

const selectedPath = computed(() => editorPayload.value.path)
const isEmpty = computed(() => openPaths.value.length === 0)
const projectRoot = computed(() => workbench.getProject(props.tab.projectId)?.rootPath ?? null)

const { isMissing, refreshMissing } = useEditorMissingPaths(projectRoot, openPaths)

const isMarkdownFile = computed(() => {
  const path = selectedPath.value
  return path.endsWith('.md') || path.endsWith('.markdown')
})

const showPreview = computed(() => isMarkdownFile.value && editorMode.value === 'preview')
const showEditor = computed(() => !isMarkdownFile.value || editorMode.value === 'edit')

const canGoBack = computed(() => historyIndex.value > 0)
const canGoForward = computed(() => historyIndex.value < pathHistory.value.length - 1)

const fileName = (path: string): string => path.split('/').pop() ?? path

const toAbsolutePath = (relativePath: string): string => {
  const root = projectRoot.value
  if (!root) {
    return ''
  }
  if (relativePath === '.' || relativePath === '') {
    return root
  }
  return `${root.replace(/\/$/, '')}/${relativePath}`
}

const parentDirectoryPath = (absolutePath: string): string => {
  const lastSlash = absolutePath.lastIndexOf('/')
  if (lastSlash <= 0) {
    return absolutePath
  }
  return absolutePath.slice(0, lastSlash)
}

const pushPathHistory = (path: string): void => {
  if (!path) {
    return
  }

  const truncated = pathHistory.value.slice(0, historyIndex.value + 1)
  if (truncated[truncated.length - 1] === path) {
    return
  }

  truncated.push(path)
  pathHistory.value = truncated
  historyIndex.value = truncated.length - 1
}

const syncWorkbenchDirty = (): void => {
  const anyDirty = Object.values(fileDirty.value).some(Boolean)
  workbench.setEditorTabDirty(props.tab.id, anyDirty)
}

const handleSelect = (path: string): void => {
  workbench.openEditor(props.tab.projectId, path)
}

const handleSelectFileTab = (path: string): void => {
  if (path === selectedPath.value) {
    return
  }
  workbench.setEditorActivePath(props.tab.id, path)
}

const handleFileTabMiddleClick = (event: MouseEvent, path: string): void => {
  if (event.button !== 1) {
    return
  }
  event.preventDefault()
  handleSubTabClose(path)
}

const handleOpenFileSearch = (): void => {
  fileSearchOpen.value = true
}

const handleFileSearchSelect = (path: string): void => {
  workbench.openEditor(props.tab.projectId, path)
}

const openWorkspaceSearch = (expandReplace = false): void => {
  sidePaneOpen.value = true
  sidePaneMode.value = 'search'
  nextTick(() => {
    sidePaneRef.value?.openSearch(expandReplace)
  })
}

const handleToggleFileTree = (): void => {
  if (!sidePaneOpen.value) {
    sidePaneOpen.value = true
    sidePaneMode.value = 'explorer'
    return
  }
  if (sidePaneMode.value === 'search') {
    sidePaneMode.value = 'explorer'
    return
  }
  sidePaneOpen.value = false
}

const handleBack = (): void => {
  if (!canGoBack.value) {
    return
  }

  const nextIndex = historyIndex.value - 1
  const path = pathHistory.value[nextIndex]
  if (!path) {
    return
  }

  historyIndex.value = nextIndex
  isNavigatingHistory.value = true
  workbench.setEditorActivePath(props.tab.id, path)
  isNavigatingHistory.value = false
}

const handleForward = (): void => {
  if (!canGoForward.value) {
    return
  }

  const nextIndex = historyIndex.value + 1
  const path = pathHistory.value[nextIndex]
  if (!path) {
    return
  }

  historyIndex.value = nextIndex
  isNavigatingHistory.value = true
  workbench.setEditorActivePath(props.tab.id, path)
  isNavigatingHistory.value = false
}

const handleSave = async (): Promise<void> => {
  try {
    await monacoRef.value?.save()
  } catch (error) {
    toast.error('Failed to save file', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleRevealInFinder = async (): Promise<void> => {
  const path = selectedPath.value
  if (!path) {
    return
  }

  const absolutePath = toAbsolutePath(path)
  const revealPath = parentDirectoryPath(absolutePath)

  try {
    await revealInFolder(revealPath)
  } catch (error) {
    toast.error('Failed to reveal in Finder', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleCopyRelativePath = async (): Promise<void> => {
  const path = selectedPath.value
  if (!path) {
    return
  }

  try {
    await navigator.clipboard.writeText(path)
  } catch (error) {
    toast.error('Failed to copy relative path', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const removeDirtyPath = (path: string): void => {
  const next = { ...fileDirty.value }
  delete next[path]
  fileDirty.value = next
  syncWorkbenchDirty()
}

const handleSubTabClose = (path: string): void => {
  if (fileDirty.value[path]) {
    closeTargetPath.value = path
    closeConfirmOpen.value = true
    return
  }
  workbench.closeEditorFile(props.tab.id, path).catch((error) => {
    toast.error('Failed to close file', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  })
}

const handleCloseConfirmOpenChange = (open: boolean): void => {
  closeConfirmOpen.value = open
  if (!open) {
    closeTargetPath.value = null
  }
}

const handleDiscardClose = async (): Promise<void> => {
  const path = closeTargetPath.value
  if (!path) {
    return
  }
  closeConfirmOpen.value = false
  closeTargetPath.value = null
  removeDirtyPath(path)
  try {
    await workbench.closeEditorFile(props.tab.id, path)
  } catch (error) {
    toast.error('Failed to close file', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleSaveAndClose = async (): Promise<void> => {
  const path = closeTargetPath.value
  if (!path) {
    return
  }

  if (path !== selectedPath.value) {
    workbench.setEditorActivePath(props.tab.id, path)
  }

  closeSaving.value = true
  try {
    const saved = await monacoRef.value?.save(path)
    if (!saved) {
      return
    }
    removeDirtyPath(path)
    closeConfirmOpen.value = false
    closeTargetPath.value = null
    await workbench.closeEditorFile(props.tab.id, path)
  } catch (error) {
    toast.error('Failed to save file', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    closeSaving.value = false
  }
}

const handleDirtyChange = (payload: { path: string; dirty: boolean }): void => {
  fileDirty.value = { ...fileDirty.value, [payload.path]: payload.dirty }
  syncWorkbenchDirty()
}

const handleSaved = (payload: { path: string; content: string }): void => {
  if (payload.path === selectedPath.value && isMarkdownFile.value) {
    fileContent.value = payload.content
  }
}

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error'
}

const loadFileContent = async (): Promise<void> => {
  const root = projectRoot.value
  const path = selectedPath.value
  if (!root || !path || !isMarkdownFile.value) {
    fileContent.value = ''
    return
  }

  try {
    const result = await fsReadFile({ projectRoot: root, path })
    fileContent.value = result.content
  } catch (error) {
    fileContent.value = ''
    toast.error('Failed to load preview', {
      description: formatError(error),
    })
  }
}

watch(selectedPath, (path) => {
  if (!path.endsWith('.md') && !path.endsWith('.markdown')) {
    editorMode.value = 'edit'
  }
})

watch(
  selectedPath,
  (path) => {
    if (isNavigatingHistory.value || !path) {
      return
    }
    pushPathHistory(path)
  },
  { immediate: true },
)

watch(
  [selectedPath, projectRoot, isMarkdownFile],
  () => {
    loadFileContent().catch((error) => {
      toast.error('Failed to load preview', {
        description: formatError(error),
      })
    })
  },
  { immediate: true },
)

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!isActiveTab.value) {
    return
  }
  const modifier = event.metaKey || event.ctrlKey
  if (!modifier || !event.shiftKey || event.altKey) {
    return
  }
  const key = event.key.toLowerCase()
  if (key === 'f') {
    event.preventDefault()
    openWorkspaceSearch(false)
    return
  }
  if (key === 'h') {
    event.preventDefault()
    openWorkspaceSearch(true)
  }
})
</script>

<template>
  <ResizablePanelGroup
    direction="horizontal"
    class="h-full min-h-0 overflow-hidden"
  >
    <ResizablePanel
      :default-size="75"
      :min-size="40"
      class="min-h-0 min-w-0 overflow-hidden"
    >
      <div class="flex h-full min-h-0 flex-col overflow-hidden">
        <div
          v-if="!isEmpty"
          class="group flex h-7 shrink-0 items-center justify-between border-b border-border/20 px-2"
        >
          <div class="flex min-w-0 flex-1 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 shrink-0 text-muted-foreground"
                  :disabled="!canGoBack"
                  aria-label="Go back"
                  @click="handleBack"
                >
                  <ChevronLeft class="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent class="z-60">Go back</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 shrink-0 text-muted-foreground"
                  :disabled="!canGoForward"
                  aria-label="Go forward"
                  @click="handleForward"
                >
                  <ChevronRight class="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent class="z-60">Go forward</TooltipContent>
            </Tooltip>
            <ScrollArea class="h-full min-w-0 flex-1">
              <div class="flex h-7 items-center gap-0.5">
                <button
                  v-for="path in openPaths"
                  :key="path"
                  type="button"
                  class="group/tab flex h-6 max-w-35 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs transition-colors"
                  :class="
                    path === selectedPath
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground/50 hover:bg-accent/30 hover:text-muted-foreground/80'
                  "
                  @click="handleSelectFileTab(path)"
                  @auxclick="handleFileTabMiddleClick($event, path)"
                >
                  <span
                    v-if="fileDirty[path]"
                    class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    aria-label="Unsaved changes"
                  />
                  <span
                    class="truncate"
                    :class="{ 'line-through': isMissing(path) }"
                  >{{ fileName(path) }}</span>
                  <span
                    class="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover/tab:opacity-100"
                    role="button"
                    aria-label="Close file"
                    @click.stop="handleSubTabClose(path)"
                  >
                    <X class="h-3 w-3" />
                  </span>
                </button>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>

          <div
            v-if="!sidePaneOpen || isMarkdownFile"
            class="flex shrink-0 items-center gap-0.5"
          >
            <template v-if="isMarkdownFile">
              <Button
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-xs"
                :class="
                  editorMode === 'edit'
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="editorMode = 'edit'"
              >
                Source
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-xs"
                :class="
                  editorMode === 'preview'
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="editorMode = 'preview'"
              >
                Preview
              </Button>
            </template>

            <Tooltip v-if="!sidePaneOpen">
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 text-muted-foreground"
                  aria-label="Search files"
                  @click="handleOpenFileSearch"
                >
                  <FileSearch class="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent class="z-60">Search files</TooltipContent>
            </Tooltip>

            <Tooltip v-if="!sidePaneOpen">
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 text-muted-foreground"
                  aria-label="Find and replace"
                  @click="openWorkspaceSearch(false)"
                >
                  <Replace class="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent class="z-60">Find and replace</TooltipContent>
            </Tooltip>

            <Tooltip v-if="!sidePaneOpen">
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 text-muted-foreground"
                  aria-label="Toggle file list"
                  @click="handleToggleFileTree"
                >
                  <List class="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent class="z-60">Toggle file list</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <Empty
          v-if="isEmpty"
          class="min-h-0 flex-1 border-none"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileCode />
            </EmptyMedia>
            <Button
              variant="ghost"
              size="sm"
              class="mt-2 text-muted-foreground"
              @click="handleOpenFileSearch"
            >
              <FileSearch class="mr-2 h-3.5 w-3.5" />
              Search files
            </Button>
          </EmptyHeader>
        </Empty>

        <div
          v-else
          class="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div
            v-show="showEditor"
            class="h-full min-h-0 min-w-0 overflow-hidden"
          >
            <WorkbenchMonacoEditor
              ref="monacoRef"
              :project-id="tab.projectId"
              :path="selectedPath"
              :open-paths="openPaths"
              :line-numbers="lineNumbers"
              :word-wrap="wordWrap"
              :diff-view="diffView"
              @dirty-change="handleDirtyChange"
              @saved="handleSaved"
            />
          </div>

          <div
            v-if="showPreview"
            class="h-full min-h-0 min-w-0 overflow-hidden"
          >
            <WorkbenchEditorMarkdownPreview
              :key="selectedPath"
              :path="selectedPath"
              :project-root="projectRoot"
              :content="fileContent"
            />
          </div>
        </div>
      </div>
    </ResizablePanel>
    <ResizableHandle v-if="sidePaneOpen" />
    <ResizablePanel
      v-if="sidePaneOpen"
      :default-size="25"
      :min-size="15"
      :max-size="55"
      class="min-h-0 min-w-0 overflow-hidden"
    >
      <WorkbenchEditorSidePane
        ref="sidePaneRef"
        v-model:open="sidePaneOpen"
        v-model:mode="sidePaneMode"
        :project-id="tab.projectId"
        :project-root="projectRoot"
        :selected-path="selectedPath"
        :diff-view="diffView"
        v-model:line-numbers="lineNumbers"
        v-model:word-wrap="wordWrap"
        v-model:auto-save="autoSave"
        v-model:format-on-save="formatOnSave"
        @select="handleSelect"
        @tree-changed="refreshMissing"
        @save="handleSave"
        @reveal-in-finder="handleRevealInFinder"
        @copy-relative-path="handleCopyRelativePath"
        @toggle-diff-view="handleToggleDiffView"
        @open-file-search="handleOpenFileSearch"
      />
    </ResizablePanel>
  </ResizablePanelGroup>

  <WorkbenchEditorFileSearchDialog
    v-model:open="fileSearchOpen"
    :project-root="projectRoot"
    @select="handleFileSearchSelect"
  />

  <AlertDialog
    :open="closeConfirmOpen"
    @update:open="handleCloseConfirmOpenChange"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Save before closing?</AlertDialogTitle>
        <AlertDialogDescription>
          <template v-if="closeTargetPath">
            "{{ fileName(closeTargetPath) }}" has unsaved changes.
          </template>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <Button
          variant="outline"
          :disabled="closeSaving"
          @click="handleDiscardClose"
        >
          Discard
        </Button>
        <Button
          :disabled="closeSaving"
          @click="handleSaveAndClose"
        >
          Save
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
