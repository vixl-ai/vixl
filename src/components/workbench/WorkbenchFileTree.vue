<script setup lang="ts">
import { AppIcon } from '@/icons'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Input } from '@/components/shadcn/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'
import { FileTree } from '@/components/ai-elements/file-tree'
import WorkbenchFileTreeNode from '@/components/workbench/FileTreeNode.vue'
import useFileTreeView from '@/composables/file-tree-view'

const props = withDefaults(
  defineProps<{
    projectId: string
    selectedPath?: string | null
    showToolbar?: boolean
  }>(),
  {
    showToolbar: true,
  },
)

const emit = defineEmits<{
  select: [path: string]
  'tree-changed': []
}>()

const {
  tree,
  expandedPaths,
  selectedPath,
  renamingPath,
  deleteTarget,
  deleting,
  refreshing,
  createDialogOpen,
  createDialogMode,
  createName,
  creating,
  projectLabel,
  refresh,
  handleRenameConfirm,
  handleRenameCancel,
  handleDeleteConfirm,
  handleDeleteOpenChange,
  handleCreateDialogOpenChange,
  handleNewFile,
  handleNewFolder,
  handleCreateConfirm,
  handleRefresh,
  handleSelect,
  handleExpandedChange,
} = useFileTreeView(props, emit)

defineExpose({
  refresh,
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden font-sans text-[13px]">
    <div
      v-if="showToolbar"
      class="flex h-7 shrink-0 items-center justify-end border-b border-border/20 px-2"
    >
      <slot name="toolbar" />
    </div>
    <div class="flex items-center justify-between px-2 py-1">
      <span class="truncate text-[13px] font-medium text-foreground">
        {{ projectLabel }}
      </span>
      <div class="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground"
              aria-label="New file"
              @click="handleNewFile"
            >
              <AppIcon name="file-plus" class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent class="z-60">New file</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground"
              aria-label="New folder"
              @click="handleNewFolder"
            >
              <AppIcon name="folder-plus" class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent class="z-60">New folder</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground"
              aria-label="Refresh"
              :disabled="refreshing"
              @click="handleRefresh"
            >
              <AppIcon
                name="refresh-cw"
                class="h-3.5 w-3.5"
                :class="{ 'animate-spin': refreshing }"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent class="z-60">Refresh</TooltipContent>
        </Tooltip>
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <FileTree
        v-if="tree?.children"
        unstyled
        class="border-0 bg-transparent p-0 font-sans text-[13px]"
        :expanded="expandedPaths"
        :selected-path="selectedPath"
        :default-expanded="expandedPaths"
        @update:selected-path="handleSelect"
        @expanded-change="handleExpandedChange"
      >
        <WorkbenchFileTreeNode
          v-for="child in tree.children"
          :key="child.path"
          :node="child"
          :renaming-path="renamingPath"
          @rename-confirm="handleRenameConfirm"
          @rename-cancel="handleRenameCancel"
        />
      </FileTree>
    </div>

    <Dialog :open="createDialogOpen" @update:open="handleCreateDialogOpenChange">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {{ createDialogMode === 'folder' ? 'New folder' : 'New file' }}
          </DialogTitle>
          <DialogDescription>
            Enter a name for the new {{ createDialogMode === 'folder' ? 'folder' : 'file' }}.
          </DialogDescription>
        </DialogHeader>
        <Input
          v-model="createName"
          :placeholder="createDialogMode === 'folder' ? 'folder-name' : 'file-name.ts'"
          @keydown.enter="handleCreateConfirm"
        />
        <DialogFooter>
          <Button
            variant="outline"
            :disabled="creating"
            @click="handleCreateDialogOpenChange(false)"
          >
            Cancel
          </Button>
          <Button :disabled="creating || !createName.trim()" @click="handleCreateConfirm">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="deleteTarget !== null" @update:open="handleDeleteOpenChange">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle
            >Delete {{ deleteTarget?.isDirectory ? 'folder' : 'file' }}?</AlertDialogTitle
          >
          <AlertDialogDescription>
            <template v-if="deleteTarget?.isDirectory">
              This will permanently delete "{{ deleteTarget.path }}" and all of its contents.
            </template>
            <template v-else> This will permanently delete "{{ deleteTarget?.path }}". </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting"> Cancel </AlertDialogCancel>
          <Button variant="destructive" :disabled="deleting" @click="handleDeleteConfirm">
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
