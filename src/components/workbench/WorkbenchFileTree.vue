<script setup lang="ts">
import { FilePlus, FolderPlus, RefreshCw } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/shadcn/ui/context-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import { FileTree } from '@/components/ai-elements/file-tree'
import WorkbenchFileTreeDialogs from '@/components/workbench/WorkbenchFileTreeDialogs.vue'
import WorkbenchFileTreeFolder from '@/components/workbench/WorkbenchFileTreeFolder.vue'
import WorkbenchFileTreeSkeleton from '@/components/workbench/WorkbenchFileTreeSkeleton.vue'
import WorkbenchFileTreeNode from '@/components/workbench/FileTreeNode.vue'
import useFileTreeView from '@/composables/file-tree-view'

const props = withDefaults(
  defineProps<{
    projectId: string
    selectedPath?: string | null
    showToolbar?: boolean
    hideChrome?: boolean
    embedded?: boolean
    rootNodeName?: string | null
  }>(),
  {
    showToolbar: true,
    hideChrome: false,
    embedded: false,
    rootNodeName: null,
  },
)

const emit = defineEmits<{
  select: [path: string]
  'tree-changed': []
  loading: [value: boolean]
}>()

const {
  tree,
  expandedPaths,
  selectedPath,
  renamingPath,
  deleteTarget,
  deleting,
  refreshing,
  loading,
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
  watchError,
  retryWatch,
} = useFileTreeView(props, emit)

watch(loading, (value) => emit('loading', value), { immediate: true })
onUnmounted(() => emit('loading', false))

defineExpose({
  refresh,
  handleNewFile,
  handleNewFolder,
})
</script>

<template>
  <div
    :class="
      embedded
        ? 'font-sans text-[13px]'
        : 'flex h-full min-h-0 flex-col overflow-hidden font-sans text-[13px]'
    "
  >
    <div
      v-if="showToolbar"
      class="flex h-7 shrink-0 items-center justify-end border-b border-border/20 px-2"
    >
      <slot name="toolbar" />
    </div>
    <div
      v-if="!hideChrome"
      class="flex items-center justify-between px-2 py-1"
    >
      <span class="min-w-0 truncate text-[13px] font-medium text-foreground">
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
              <FilePlus class="h-3.5 w-3.5" />
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
              <FolderPlus class="h-3.5 w-3.5" />
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
              <RefreshCw
                class="h-3.5 w-3.5"
                :class="{ 'animate-spin': refreshing }"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent class="z-60">Refresh</TooltipContent>
        </Tooltip>
      </div>
    </div>
    <div
      v-if="watchError"
      class="flex items-center justify-between gap-2 px-2 pb-1"
    >
      <p class="min-w-0 truncate text-[11px] text-destructive">
        {{ watchError }}
      </p>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 shrink-0 px-2 text-[11px]"
        @click="retryWatch"
      >
        Retry watch
      </Button>
    </div>
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div
          :class="
            embedded
              ? 'px-0'
              : 'relative min-h-0 flex-1 overflow-y-auto px-2 pb-2'
          "
        >
          <WorkbenchFileTreeSkeleton
            v-if="loading && !tree"
            :class="embedded ? undefined : 'absolute inset-0'"
          />
          <FileTree
            v-else-if="tree?.children"
            unstyled
            class="border-0 bg-transparent p-0 font-sans text-[13px]"
            :expanded="expandedPaths"
            :selected-path="selectedPath"
            :default-expanded="expandedPaths"
            @update:selected-path="handleSelect"
            @expanded-change="handleExpandedChange"
          >
            <WorkbenchFileTreeFolder
              v-if="rootNodeName"
              path="."
              :name="rootNodeName"
            >
              <WorkbenchFileTreeNode
                v-for="child in tree.children"
                :key="child.path"
                :node="child"
                :renaming-path="renamingPath"
                @rename-confirm="handleRenameConfirm"
                @rename-cancel="handleRenameCancel"
              />
            </WorkbenchFileTreeFolder>
            <template v-else>
              <WorkbenchFileTreeNode
                v-for="child in tree.children"
                :key="child.path"
                :node="child"
                :renaming-path="renamingPath"
                @rename-confirm="handleRenameConfirm"
                @rename-cancel="handleRenameCancel"
              />
            </template>
          </FileTree>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem @select="handleNewFile('.')">
          <FilePlus />
          New File
        </ContextMenuItem>
        <ContextMenuItem @select="handleNewFolder('.')">
          <FolderPlus />
          New Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <WorkbenchFileTreeDialogs
      :create-dialog-open="createDialogOpen"
      :create-dialog-mode="createDialogMode"
      :create-name="createName"
      :creating="creating"
      :delete-target="deleteTarget"
      :deleting="deleting"
      @update:create-dialog-open="handleCreateDialogOpenChange"
      @update:create-name="createName = $event"
      @create-confirm="handleCreateConfirm"
      @delete-open-change="handleDeleteOpenChange"
      @delete-confirm="handleDeleteConfirm"
    />
  </div>
</template>
