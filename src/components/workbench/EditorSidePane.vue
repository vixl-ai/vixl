<script setup lang="ts">
import { AppIcon } from '@/icons'
import { Button } from '@/components/shadcn/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'

export type EditorSidePaneMode = 'explorer' | 'search'

const open = defineModel<boolean>('open', { required: true })
const mode = defineModel<EditorSidePaneMode>('mode', { required: true })

defineProps<{
  projectId: string
  projectRoot: string | null
  selectedPath: string
  diffView: boolean
  lineNumbers: boolean
  wordWrap: boolean
  autoSave: boolean
  formatOnSave: boolean
}>()

const emit = defineEmits<{
  select: [path: string]
  'tree-changed': []
  save: []
  'reveal-in-finder': []
  'copy-relative-path': []
  'toggle-diff-view': []
  'open-file-search': []
  'update:lineNumbers': [value: boolean]
  'update:wordWrap': [value: boolean]
  'update:autoSave': [value: boolean]
  'update:formatOnSave': [value: boolean]
}>()

const searchPanelRef = ref<{ focusFind: (expandReplace?: boolean) => void } | null>(null)

const openSearch = (expandReplace = false): void => {
  open.value = true
  mode.value = 'search'
  nextTick(() => {
    searchPanelRef.value?.focusFind(expandReplace)
  })
}

const handleFileSearchClick = (): void => {
  emit('open-file-search')
}

const handleFindReplaceClick = (): void => {
  openSearch(false)
}

const handleListClick = (): void => {
  if (!open.value) {
    open.value = true
    mode.value = 'explorer'
    return
  }
  if (mode.value === 'search') {
    mode.value = 'explorer'
    return
  }
  open.value = false
}

const handleSelect = (path: string): void => {
  emit('select', path)
}

const handleTreeChanged = (): void => {
  emit('tree-changed')
}

defineExpose({
  openSearch,
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="flex h-7 shrink-0 items-center justify-end border-b border-border/20 px-2">
      <div class="flex shrink-0 items-center gap-0.5">
        <Tooltip :disable-closing-trigger="true">
          <TooltipTrigger as-child>
            <span class="inline-flex shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-6 w-6 text-muted-foreground"
                    aria-label="File actions"
                  >
                    <AppIcon name="more-horizontal" class="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-56">
                  <DropdownMenuLabel>File</DropdownMenuLabel>
                  <DropdownMenuItem @click="emit('save')">
                    <AppIcon name="save" class="mr-2 h-4 w-4" />
                    Save
                    <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="emit('reveal-in-finder')">
                    <AppIcon name="folder-search" class="mr-2 h-4 w-4" />
                    Reveal in Finder
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="emit('copy-relative-path')">
                    <AppIcon name="clipboard-copy" class="mr-2 h-4 w-4" />
                    Copy Relative Path
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>View</DropdownMenuLabel>
                  <DropdownMenuItem @click="emit('toggle-diff-view')">
                    <AppIcon name="git-compare-arrows" class="mr-2 h-4 w-4" />
                    Diff View
                    <AppIcon name="check" v-if="diffView" class="ml-auto h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="emit('update:lineNumbers', !lineNumbers)">
                    <AppIcon name="list-ordered" class="mr-2 h-4 w-4" />
                    Line Numbers
                    <AppIcon name="check" v-if="lineNumbers" class="ml-auto h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="emit('update:wordWrap', !wordWrap)">
                    <AppIcon name="wrap-text" class="mr-2 h-4 w-4" />
                    Word Wrap
                    <AppIcon name="check" v-if="wordWrap" class="ml-auto h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Editor</DropdownMenuLabel>
                  <DropdownMenuItem @click="emit('update:autoSave', !autoSave)">
                    <AppIcon name="save-all" class="mr-2 h-4 w-4" />
                    Auto Save
                    <AppIcon name="check" v-if="autoSave" class="ml-auto h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="emit('update:formatOnSave', !formatOnSave)">
                    <AppIcon name="wand-sparkles" class="mr-2 h-4 w-4" />
                    Format on Save
                    <AppIcon name="check" v-if="formatOnSave" class="ml-auto h-4 w-4" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </TooltipTrigger>
          <TooltipContent class="z-60">File actions</TooltipContent>
        </Tooltip>

        <WorkbenchLspStatus />

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground"
              aria-label="Search files"
              @click="handleFileSearchClick"
            >
              <AppIcon name="file-search" class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent class="z-60">Search files</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground"
              :class="mode === 'search' ? 'text-foreground' : ''"
              aria-label="Find and replace"
              @click="handleFindReplaceClick"
            >
              <AppIcon name="replace" class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent class="z-60">Find and replace</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground"
              :class="mode === 'explorer' ? 'text-foreground' : ''"
              aria-label="Toggle file list"
              @click="handleListClick"
            >
              <AppIcon name="list" class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent class="z-60">Toggle file list</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <WorkbenchFileTree
        v-show="mode === 'explorer'"
        class="h-full"
        :project-id="projectId"
        :selected-path="selectedPath"
        :show-toolbar="false"
        @select="handleSelect"
        @tree-changed="handleTreeChanged"
      />
      <WorkspaceSearchPanel
        v-show="mode === 'search'"
        ref="searchPanelRef"
        class="h-full"
        :project-id="projectId"
        :project-root="projectRoot"
      />
    </div>
  </div>
</template>
