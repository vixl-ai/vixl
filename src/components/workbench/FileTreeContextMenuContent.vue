<script setup lang="ts">
import {
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  ExternalLink,
  File,
  FilePlus,
  FolderOpen,
  FolderPlus,
  MessageSquarePlus,
  Pencil,
  Scissors,
  Terminal,
  Trash2,
} from '@lucide/vue'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@/components/shadcn/ui/context-menu'
import WorkbenchFileEntryIcon from '@/components/workbench/FileEntryIcon.vue'
import { parentPath } from '@/composables/file-tree-view/path-helpers'

const props = defineProps<{
  name: string
  path: string
  isDirectory: boolean
}>()

const {
  clipboard,
  copyRelativePath,
  copyAbsolutePath,
  copyName,
  revealInFinder,
  openInEditor,
  handleRename,
  handleDelete,
  startCreate,
  handleCut,
  handleCopy,
  handlePaste,
  handleAddFileToChat,
  handleAddFileToNewChat,
  handleOpenInTerminal,
} = useFileTreeNodeMenu()

const createParentDir = computed(() =>
  props.isDirectory ? props.path : parentPath(props.path),
)

const isMemberRoot = computed(
  () => props.path === '.' || props.path === '',
)

const handleCopyRelativePath = async (): Promise<void> => {
  await copyRelativePath(props.path)
}

const handleCopyAbsolutePath = async (): Promise<void> => {
  await copyAbsolutePath(props.path)
}

const handleCopyName = async (): Promise<void> => {
  await copyName(props.name)
}

const handleRevealInFinder = async (): Promise<void> => {
  await revealInFinder(props.path, props.isDirectory)
}

const handleOpenInEditor = (): void => {
  openInEditor(props.path)
}

const handleRenameSelect = (): void => {
  handleRename(props.path)
}

const handleDeleteSelect = (): void => {
  handleDelete(props.path, props.isDirectory)
}

const handleCutSelect = (): void => {
  handleCut(props.path)
}

const handleCopySelect = (): void => {
  handleCopy(props.path)
}

const handlePasteSelect = async (): Promise<void> => {
  await handlePaste(props.path)
}

const handleAddFileToChatSelect = (): void => {
  handleAddFileToChat(props.path)
}

const handleAddFileToNewChatSelect = async (): Promise<void> => {
  await handleAddFileToNewChat(props.path)
}

const handleOpenInTerminalSelect = async (): Promise<void> => {
  await handleOpenInTerminal(props.path, props.isDirectory)
}

const handleNewFileSelect = (): void => {
  startCreate('file', createParentDir.value)
}

const handleNewFolderSelect = (): void => {
  startCreate('folder', createParentDir.value)
}
</script>

<template>
  <ContextMenuContent class="w-56">
    <ContextMenuLabel class="flex items-center gap-1.5">
      <WorkbenchFileEntryIcon :name="name" :is-directory="isDirectory" />
      <span class="truncate">{{ name }}</span>
    </ContextMenuLabel>
    <ContextMenuSeparator />
    <ContextMenuItem @select="handleNewFileSelect">
      <FilePlus />
      New File
    </ContextMenuItem>
    <ContextMenuItem @select="handleNewFolderSelect">
      <FolderPlus />
      New Folder
    </ContextMenuItem>
    <ContextMenuSeparator v-if="!isMemberRoot" />
    <ContextMenuItem
      v-if="!isMemberRoot"
      @select="handleRenameSelect"
    >
      <Pencil />
      Rename
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem
      v-if="!isMemberRoot"
      @select="handleCutSelect"
    >
      <Scissors />
      Cut
    </ContextMenuItem>
    <ContextMenuItem @select="handleCopySelect">
      <ClipboardCopy />
      Copy
    </ContextMenuItem>
    <ContextMenuItem
      v-if="isDirectory"
      :disabled="!clipboard.hasClipboard.value"
      @select="handlePasteSelect"
    >
      <ClipboardPaste />
      Paste
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem
      v-if="!isDirectory"
      @select="handleAddFileToChatSelect"
    >
      <File />
      Add file to chat
    </ContextMenuItem>
    <ContextMenuItem
      v-if="!isDirectory"
      @select="handleAddFileToNewChatSelect"
    >
      <MessageSquarePlus />
      Add file to new chat
    </ContextMenuItem>
    <ContextMenuItem @select="handleOpenInTerminalSelect">
      <Terminal />
      Open in terminal
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem @select="handleCopyRelativePath">
      <Copy />
      Copy relative path
    </ContextMenuItem>
    <ContextMenuItem @select="handleCopyAbsolutePath">
      <Copy />
      Copy path
    </ContextMenuItem>
    <ContextMenuItem @select="handleCopyName">
      <Copy />
      Copy name
    </ContextMenuItem>
    <ContextMenuItem @select="handleRevealInFinder">
      <FolderOpen />
      Reveal in Finder
    </ContextMenuItem>
    <ContextMenuItem
      v-if="!isDirectory"
      @select="handleOpenInEditor"
    >
      <ExternalLink />
      Open in editor
    </ContextMenuItem>
    <ContextMenuSeparator v-if="!isMemberRoot" />
    <ContextMenuItem
      v-if="!isMemberRoot"
      variant="destructive"
      @select="handleDeleteSelect"
    >
      <Trash2 />
      Delete
    </ContextMenuItem>
  </ContextMenuContent>
</template>
